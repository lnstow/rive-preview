import {
  Alignment,
  DataType,
  Fit,
  Layout,
  Rive,
  RiveFile,
  StateMachineInputType,
  type RiveParameters,
  type RiveResetParameters,
  type ViewModelInstance,
} from "@rive-app/webgl2";

import "./styles.css";

type MotionKind = "stateMachine" | "animation" | "none";

interface MotionSelection {
  kind: MotionKind;
  name: string;
}

interface InitialSelection {
  artboard?: string;
  motion: MotionSelection;
}

interface StateMachineInputInfo {
  name: string;
  type: string;
  initialValue: string;
}

interface StateMachineInfo {
  name: string;
  inputs: StateMachineInputInfo[];
}

interface ArtboardInfo {
  name: string;
  animations: string[];
  stateMachines: StateMachineInfo[];
}

interface PropertyInfo {
  name: string;
  type: string;
  value?: string;
}

interface ViewModelInfo {
  name: string;
  instanceCount: number;
  instanceNames: string[];
  properties: PropertyInfo[];
}

interface DataEnumInfo {
  name: string;
  values: string[];
}

interface BoundInstanceInfo {
  name: string;
  properties: PropertyInfo[];
}

interface RuntimeInfo {
  activeArtboard: string;
  artboardWidth: number;
  artboardHeight: number;
  isPlaying: boolean;
}

interface RiveMetadata {
  fileName: string;
  fileSize: number;
  fileModified: number;
  artboards: ArtboardInfo[];
  viewModels: ViewModelInfo[];
  dataEnums: DataEnumInfo[];
  boundInstance: BoundInstanceInfo | null;
  runtime: RuntimeInfo;
}

interface FileContext {
  fileName: string;
  fileSize: number;
  fileModified: number;
}

type Tone = "idle" | "busy" | "ready" | "error";
type ViewModelPropertyLike = { name: string; type: string };

const dropzone = getElement<HTMLLabelElement>("dropzone");
const fileInput = getElement<HTMLInputElement>("fileInput");
const fileMeta = getElement<HTMLSpanElement>("fileMeta");
const canvas = getElement<HTMLCanvasElement>("riveCanvas");
const canvasStage = getElement<HTMLDivElement>("canvasStage");
const artboardFrame = getElement<HTMLDivElement>("artboardFrame");
const emptyState = getElement<HTMLDivElement>("emptyState");
const propertiesPanel = getElement<HTMLDivElement>("propertiesPanel");
const statusPill = getElement<HTMLDivElement>("statusPill");
const artboardSelect = getElement<HTMLSelectElement>("artboardSelect");
const motionSelect = getElement<HTMLSelectElement>("motionSelect");
const fitSelect = getElement<HTMLSelectElement>("fitSelect");
const playButton = getElement<HTMLButtonElement>("playButton");

let activeRive: Rive | null = null;
let activeRiveFile: RiveFile | null = null;
let currentFile: FileContext | null = null;
let currentMetadata: RiveMetadata | null = null;
let isSyncingControls = false;

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) {
    void loadFile(file);
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, () => {
    dropzone.classList.remove("is-dragging");
  });
}

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    void loadFile(file);
  }
});

artboardSelect.addEventListener("change", () => {
  if (isSyncingControls || !currentMetadata) {
    return;
  }

  populateMotionSelect(getSelectedArtboard());
  resetPreviewFromControls();
});

motionSelect.addEventListener("change", () => {
  if (!isSyncingControls) {
    resetPreviewFromControls();
  }
});

fitSelect.addEventListener("change", () => {
  if (!activeRive) {
    return;
  }

  activeRive.layout = new Layout({
    fit: fitSelect.value as Fit,
    alignment: Alignment.Center,
  });
  activeRive.resizeDrawingSurfaceToCanvas();
  updateArtboardFrame();
  refreshMetadata();
});

playButton.addEventListener("click", () => {
  if (!activeRive) {
    return;
  }

  if (safeValue(() => activeRive?.isPlaying ?? false, false)) {
    activeRive.pause();
  } else {
    activeRive.play();
  }
  refreshMetadata();
});

const resizeObserver = new ResizeObserver(() => {
  activeRive?.resizeDrawingSurfaceToCanvas();
  updateArtboardFrame();
});
resizeObserver.observe(canvasStage);

async function loadFile(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".riv")) {
    setStatus("Unsupported file", "error");
    renderError("Please choose a .riv file.");
    return;
  }

  setStatus("Loading", "busy");
  setControlsEnabled(false);
  emptyState.hidden = true;
  currentFile = {
    fileName: file.name,
    fileSize: file.size,
    fileModified: file.lastModified,
  };
  fileMeta.textContent = `${file.name} · ${formatBytes(file.size)}`;

  cleanupActiveRive();

  try {
    const buffer = await file.arrayBuffer();
    const riveFile = new RiveFile({ buffer });
    activeRiveFile = riveFile;
    await riveFile.init();

    const initialSelection = getInitialSelection(riveFile);
    await createPreview(riveFile, initialSelection);
  } catch (error) {
    cleanupActiveRive();
    setStatus("Load failed", "error");
    renderError(error instanceof Error ? error.message : "Failed to load the Rive file.");
  }
}

function createPreview(riveFile: RiveFile, selection: InitialSelection): Promise<void> {
  return new Promise((resolve, reject) => {
    const params: RiveParameters = {
      canvas,
      riveFile,
      artboard: selection.artboard,
      autoplay: true,
      autoBind: true,
      enableRiveAssetCDN: true,
      layout: new Layout({
        fit: fitSelect.value as Fit,
        alignment: Alignment.Center,
      }),
      onLoad: () => {
        if (!activeRive || !currentFile) {
          reject(new Error("Rive preview instance was not initialized."));
          return;
        }

        activeRive.resizeDrawingSurfaceToCanvas();
        currentMetadata = collectMetadata(activeRive, currentFile);
        updateArtboardFrame(currentMetadata.runtime);
        syncControls(currentMetadata, selection);
        renderMetadata(currentMetadata);
        emptyState.hidden = true;
        setControlsEnabled(true);
        setStatus("Loaded", "ready");
        resolve();
      },
      onLoadError: (event) => {
        reject(new Error(String(event.data ?? "Failed to load the Rive file.")));
      },
    };

    if (selection.motion.kind === "stateMachine") {
      params.stateMachines = selection.motion.name;
    } else if (selection.motion.kind === "animation") {
      params.animations = selection.motion.name;
    }

    activeRive = new Rive(params);
  });
}

function cleanupActiveRive(): void {
  activeRive?.cleanup();
  activeRive = null;

  activeRiveFile?.cleanup();
  activeRiveFile = null;

  currentMetadata = null;
  hideArtboardFrame();
}

function resetPreviewFromControls(): void {
  if (!activeRive) {
    return;
  }

  const motion = parseMotionValue(motionSelect.value);
  const params: RiveResetParameters = {
    artboard: artboardSelect.value || undefined,
    autoplay: true,
    autoBind: true,
  };

  if (motion.kind === "stateMachine") {
    params.stateMachines = motion.name;
  } else if (motion.kind === "animation") {
    params.animations = motion.name;
  }

  activeRive.reset(params);
  activeRive.resizeDrawingSurfaceToCanvas();
  updateArtboardFrame();
  refreshMetadata();
}

function refreshMetadata(): void {
  if (!activeRive || !currentFile) {
    return;
  }

  currentMetadata = collectMetadata(activeRive, currentFile);
  updateArtboardFrame(currentMetadata.runtime);
  renderMetadata(currentMetadata);
}

function updateArtboardFrame(runtime = currentMetadata?.runtime): void {
  if (!runtime) {
    hideArtboardFrame();
    return;
  }

  const artboardWidth = runtime.artboardWidth;
  const artboardHeight = runtime.artboardHeight;
  const stageWidth = canvasStage.clientWidth;
  const stageHeight = canvasStage.clientHeight;

  if (artboardWidth <= 0 || artboardHeight <= 0 || stageWidth <= 0 || stageHeight <= 0) {
    hideArtboardFrame();
    return;
  }

  const { width, height } = getFittedArtboardSize(
    artboardWidth,
    artboardHeight,
    stageWidth,
    stageHeight,
    fitSelect.value as Fit,
  );

  artboardFrame.hidden = false;
  artboardFrame.style.width = `${width}px`;
  artboardFrame.style.height = `${height}px`;
  artboardFrame.title = `${formatNumber(artboardWidth)} × ${formatNumber(artboardHeight)}`;
}

function hideArtboardFrame(): void {
  artboardFrame.hidden = true;
  artboardFrame.removeAttribute("style");
  artboardFrame.removeAttribute("title");
}

function getFittedArtboardSize(
  artboardWidth: number,
  artboardHeight: number,
  stageWidth: number,
  stageHeight: number,
  fit: Fit,
): { width: number; height: number } {
  const widthScale = stageWidth / artboardWidth;
  const heightScale = stageHeight / artboardHeight;

  switch (fit) {
    case Fit.Cover:
      return scaleArtboard(artboardWidth, artboardHeight, Math.max(widthScale, heightScale));
    case Fit.Fill:
      return { width: stageWidth, height: stageHeight };
    case Fit.FitWidth:
      return scaleArtboard(artboardWidth, artboardHeight, widthScale);
    case Fit.FitHeight:
      return scaleArtboard(artboardWidth, artboardHeight, heightScale);
    case Fit.None:
      return { width: artboardWidth, height: artboardHeight };
    case Fit.ScaleDown:
      return scaleArtboard(artboardWidth, artboardHeight, Math.min(1, widthScale, heightScale));
    case Fit.Contain:
    default:
      return scaleArtboard(artboardWidth, artboardHeight, Math.min(widthScale, heightScale));
  }
}

function scaleArtboard(width: number, height: number, scale: number): { width: number; height: number } {
  return {
    width: width * scale,
    height: height * scale,
  };
}

function getInitialSelection(riveFile: RiveFile): InitialSelection {
  const fallback: InitialSelection = {
    motion: { kind: "none", name: "" },
  };

  try {
    const file = riveFile.getInstance();
    const artboard = file.defaultArtboard();
    try {
      return {
        artboard: artboard.name,
        motion: getFirstMotionFromArtboard(artboard),
      };
    } finally {
      artboard.delete();
    }
  } catch {
    return fallback;
  }
}

function getFirstMotionFromArtboard(artboard: ReturnType<ReturnType<RiveFile["getInstance"]>["defaultArtboard"]>): MotionSelection {
  const stateMachineCount = safeNumber(() => artboard.stateMachineCount());
  if (stateMachineCount > 0) {
    return {
      kind: "stateMachine",
      name: artboard.stateMachineByIndex(0).name,
    };
  }

  const animationCount = safeNumber(() => artboard.animationCount());
  if (animationCount > 0) {
    return {
      kind: "animation",
      name: artboard.animationByIndex(0).name,
    };
  }

  return { kind: "none", name: "" };
}

function collectMetadata(rive: Rive, file: FileContext): RiveMetadata {
  const artboards = (rive.contents.artboards ?? []).map((artboard) => ({
    name: artboard.name,
    animations: [...artboard.animations],
    stateMachines: artboard.stateMachines.map((stateMachine) => ({
      name: stateMachine.name,
      inputs: stateMachine.inputs.map((input) => ({
        name: input.name,
        type: inputTypeName(input.type),
        initialValue: formatValue(input.initialValue),
      })),
    })),
  }));

  const viewModels: ViewModelInfo[] = [];
  for (let index = 0; index < safeNumber(() => rive.viewModelCount); index += 1) {
    const viewModel = safeOptional(() => rive.viewModelByIndex(index));
    if (!viewModel) {
      continue;
    }

    viewModels.push({
      name: viewModel.name || `ViewModel ${index + 1}`,
      instanceCount: viewModel.instanceCount,
      instanceNames: [...viewModel.instanceNames],
      properties: viewModel.properties.map((property) => ({
        name: property.name,
        type: String(property.type),
      })),
    });
  }

  const dataEnums = safeValue(() => rive.enums(), []).map((dataEnum) => ({
    name: dataEnum.name,
    values: [...dataEnum.values],
  }));

  return {
    ...file,
    artboards,
    viewModels,
    dataEnums,
    boundInstance: inspectBoundInstance(rive.viewModelInstance),
    runtime: {
      activeArtboard: safeValue(() => rive.activeArtboard, ""),
      artboardWidth: safeNumber(() => rive.artboardWidth),
      artboardHeight: safeNumber(() => rive.artboardHeight),
      isPlaying: safeValue(() => rive.isPlaying, false),
    },
  };
}

function inspectBoundInstance(instance: ViewModelInstance | null): BoundInstanceInfo | null {
  if (!instance) {
    return null;
  }

  const properties = instance.properties.map((property) => ({
    name: property.name,
    type: String(property.type),
    value: readInstanceValue(instance, property),
  }));

  return {
    name: instance.viewModelName,
    properties,
  };
}

function readInstanceValue(instance: ViewModelInstance, property: ViewModelPropertyLike): string {
  const type = String(property.type);

  try {
    switch (type) {
      case DataType.string:
        return formatValue(instance.string(property.name)?.value);
      case DataType.number:
      case DataType.integer:
      case DataType.listIndex:
        return formatValue(instance.number(property.name)?.value);
      case DataType.boolean:
        return formatValue(instance.boolean(property.name)?.value);
      case DataType.color:
        return formatColor(instance.color(property.name)?.value);
      case DataType.enumType: {
        const enumValue = instance.enum(property.name);
        return enumValue ? `${enumValue.value} · #${enumValue.valueIndex}` : "—";
      }
      case DataType.list:
        return `${instance.list(property.name)?.length ?? 0} items`;
      case DataType.trigger:
        return "trigger";
      case DataType.image:
      case DataType.artboard:
      case DataType.viewModel:
        return "reference";
      default:
        return "—";
    }
  } catch {
    return "—";
  }
}

function syncControls(metadata: RiveMetadata, selection: InitialSelection): void {
  isSyncingControls = true;

  artboardSelect.replaceChildren();
  for (const artboard of metadata.artboards) {
    artboardSelect.append(new Option(artboard.name, artboard.name));
  }

  const selectedArtboard = selection.artboard || metadata.artboards[0]?.name || "";
  artboardSelect.value = selectedArtboard;
  populateMotionSelect(selectedArtboard, selection.motion);

  isSyncingControls = false;
}

function populateMotionSelect(artboardName: string, preferred?: MotionSelection): void {
  motionSelect.replaceChildren();
  const artboard = currentMetadata?.artboards.find((item) => item.name === artboardName);

  if (!artboard) {
    motionSelect.append(new Option("None", motionValue({ kind: "none", name: "" })));
    return;
  }

  for (const stateMachine of artboard.stateMachines) {
    motionSelect.append(new Option(`State Machine · ${stateMachine.name}`, motionValue({ kind: "stateMachine", name: stateMachine.name })));
  }

  for (const animation of artboard.animations) {
    motionSelect.append(new Option(`Animation · ${animation}`, motionValue({ kind: "animation", name: animation })));
  }

  if (motionSelect.options.length === 0) {
    motionSelect.append(new Option("Static artboard", motionValue({ kind: "none", name: "" })));
  }

  const preferredValue = preferred ? motionValue(preferred) : "";
  if (preferredValue && [...motionSelect.options].some((option) => option.value === preferredValue)) {
    motionSelect.value = preferredValue;
  } else {
    motionSelect.selectedIndex = 0;
  }
}

function getSelectedArtboard(): string {
  return artboardSelect.value || currentMetadata?.artboards[0]?.name || "";
}

function motionValue(selection: MotionSelection): string {
  return `${selection.kind}:${selection.name}`;
}

function parseMotionValue(value: string): MotionSelection {
  const [kind, ...nameParts] = value.split(":");
  const name = nameParts.join(":");

  if (kind === "stateMachine" || kind === "animation") {
    return { kind, name };
  }

  return { kind: "none", name: "" };
}

function renderMetadata(metadata: RiveMetadata): void {
  propertiesPanel.replaceChildren();
  syncPlaybackButton(metadata.runtime);

  propertiesPanel.append(
    renderMetrics(metadata),
    renderArtboards(metadata.artboards, metadata.runtime.activeArtboard),
    renderViewModels(metadata.viewModels, metadata.boundInstance),
    renderDataEnums(metadata.dataEnums),
  );
}

function renderMetrics(metadata: RiveMetadata): HTMLElement {
  const section = createSection("File");
  const grid = createElement("div", "metrics-grid");

  grid.append(
    createMetric("Artboards", String(metadata.artboards.length)),
    createMetric("State Machines", String(countStateMachines(metadata.artboards))),
    createMetric("View Models", String(metadata.viewModels.length)),
    createMetric("Artboard Size", `${formatNumber(metadata.runtime.artboardWidth)} × ${formatNumber(metadata.runtime.artboardHeight)}`),
  );

  section.append(grid);
  return section;
}

function renderArtboards(artboards: ArtboardInfo[], activeArtboard: string): HTMLElement {
  const section = createSection("Artboard");
  const list = createElement("div", "stack");
  const currentArtboard = getCurrentArtboard(artboards, activeArtboard);

  if (!currentArtboard) {
    list.append(createEmptyLine("No artboard found"));
    section.append(list);
    return section;
  }

  const item = createElement("article", "property-card is-active");
  item.append(createCardTitle(currentArtboard.name, "active"));
  item.append(renderNameRow("Animations", currentArtboard.animations, "None"));

  const stateMachines = createElement("div", "nested-list");
  if (currentArtboard.stateMachines.length === 0) {
    stateMachines.append(createEmptyLine("No state machines"));
  }

  for (const stateMachine of currentArtboard.stateMachines) {
    const stateItem = createElement("div", "nested-item");
    stateItem.append(createCardTitle(stateMachine.name, `${stateMachine.inputs.length} inputs`, "small"));
    stateItem.append(renderProperties(stateMachine.inputs.map((input) => ({
      name: input.name,
      type: input.type,
      value: input.initialValue,
    }))));
    stateMachines.append(stateItem);
  }

  item.append(createSubhead("State Machines"), stateMachines);
  list.append(item);
  section.append(list);
  return section;
}

function getCurrentArtboard(artboards: ArtboardInfo[], activeArtboard: string): ArtboardInfo | undefined {
  return artboards.find((artboard) => artboard.name === activeArtboard) ?? artboards[0];
}

function renderViewModels(viewModels: ViewModelInfo[], boundInstance: BoundInstanceInfo | null): HTMLElement {
  const section = createSection("View Models");
  const list = createElement("div", "stack");

  if (viewModels.length === 0) {
    list.append(createEmptyLine("No view models found"));
  }

  for (const viewModel of viewModels) {
    const isAutoBound = boundInstance?.name === viewModel.name;
    const titleMeta = isAutoBound ? "auto bound" : "";
    const properties = isAutoBound ? mergeBoundProperties(viewModel.properties, boundInstance.properties) : viewModel.properties;
    const item = createElement("article", isAutoBound ? "property-card highlight" : "property-card");
    item.append(createCardTitle(viewModel.name, titleMeta));
    item.append(renderNameRow("Instances", viewModel.instanceNames, "No named instances"));
    item.append(createSubhead("Properties"), renderProperties(properties));
    list.append(item);
  }

  section.append(list);
  return section;
}

function mergeBoundProperties(properties: PropertyInfo[], boundProperties: PropertyInfo[]): PropertyInfo[] {
  const boundByName = new Map(boundProperties.map((property) => [property.name, property]));
  const merged = properties.map((property) => ({
    ...property,
    value: boundByName.get(property.name)?.value ?? property.value,
  }));
  const knownNames = new Set(properties.map((property) => property.name));

  for (const boundProperty of boundProperties) {
    if (!knownNames.has(boundProperty.name)) {
      merged.push(boundProperty);
    }
  }

  return merged;
}

function renderDataEnums(dataEnums: DataEnumInfo[]): HTMLElement {
  const section = createSection("Data Enums");
  const list = createElement("div", "stack");

  if (dataEnums.length === 0) {
    list.append(createEmptyLine("No data enums found"));
  }

  for (const dataEnum of dataEnums) {
    const item = createElement("article", "property-card");
    item.append(createCardTitle(dataEnum.name, `${dataEnum.values.length} values`));
    item.append(renderNameRow("Values", dataEnum.values, "None"));
    list.append(item);
  }

  section.append(list);
  return section;
}

function renderProperties(properties: PropertyInfo[]): HTMLElement {
  const list = createElement("div", "property-list");

  if (properties.length === 0) {
    list.append(createEmptyLine("No properties"));
    return list;
  }

  for (const property of properties) {
    const row = createElement("div", "property-row");
    const name = createElement("span", "property-name", property.name);
    const type = createElement("span", "property-type", property.type);
    row.append(name, type);

    if (property.value !== undefined) {
      row.append(createElement("span", "property-value", property.value));
    }

    list.append(row);
  }

  return list;
}

function renderNameRow(label: string, names: string[], emptyText: string): HTMLElement {
  const row = createElement("div", "name-row");
  row.append(createElement("span", "name-row-label", label));
  const chips = createElement("div", "chip-row");

  if (names.length === 0) {
    chips.append(createElement("span", "muted", emptyText));
  } else {
    for (const name of names) {
      chips.append(createElement("span", "chip", name));
    }
  }

  row.append(chips);
  return row;
}

function renderError(message: string): void {
  propertiesPanel.replaceChildren();
  const card = createElement("div", "empty-card error");
  card.append(createElement("strong", undefined, "Load failed"), createElement("span", undefined, message));
  propertiesPanel.append(card);
}

function renderMetricsPlaceholder(): void {
  propertiesPanel.replaceChildren();
  const card = createElement("div", "empty-card");
  card.append(createElement("strong", undefined, "Waiting for file"), createElement("span", undefined, "Properties will appear here"));
  propertiesPanel.append(card);
}

function createSection(title: string): HTMLElement {
  const section = createElement("section", "property-section");
  section.append(createElement("h3", undefined, title));
  return section;
}

function createMetric(label: string, value: string): HTMLElement {
  const metric = createElement("div", "metric");
  metric.append(createElement("span", undefined, label), createElement("strong", undefined, value));
  return metric;
}

function createCardTitle(title: string, meta: string, size: "normal" | "small" = "normal"): HTMLElement {
  const header = createElement("div", size === "small" ? "card-title small" : "card-title");
  header.append(createElement("strong", undefined, title));

  if (meta) {
    header.append(createElement("span", undefined, meta));
  }

  return header;
}

function createSubhead(text: string): HTMLElement {
  return createElement("div", "subhead", text);
}

function createEmptyLine(text: string): HTMLElement {
  return createElement("p", "empty-line", text);
}

function setStatus(text: string, tone: Tone): void {
  statusPill.textContent = text;
  statusPill.dataset.tone = tone;
}

function setControlsEnabled(enabled: boolean): void {
  for (const control of [artboardSelect, motionSelect, fitSelect, playButton]) {
    control.disabled = !enabled;
  }

  if (!enabled) {
    syncPlaybackButton();
  }
}

function syncPlaybackButton(runtime?: RuntimeInfo): void {
  const label = runtime?.isPlaying ? "Pause" : "Play";
  playButton.title = label;
  playButton.setAttribute("aria-label", label);
  playButton.querySelector("span")?.replaceChildren(document.createTextNode(runtime?.isPlaying ? "\u275A\u275A" : "\u25B6"));
}

function inputTypeName(type: StateMachineInputType): string {
  switch (type) {
    case StateMachineInputType.Number:
      return "number";
    case StateMachineInputType.Boolean:
      return "boolean";
    case StateMachineInputType.Trigger:
      return "trigger";
    default:
      return `input ${type}`;
  }
}

function countStateMachines(artboards: ArtboardInfo[]): number {
  return artboards.reduce((total, artboard) => total + artboard.stateMachines.length, 0);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${formatNumber(value)} ${units[unitIndex]}`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "—";
  }

  return String(value);
}

function formatColor(value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }

  return `#${(value >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function safeNumber(read: () => number): number {
  return safeValue(read, 0);
}

function safeValue<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function safeOptional<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id}`);
  }

  return element as T;
}

renderMetricsPlaceholder();
