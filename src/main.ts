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
const emptyState = getElement<HTMLDivElement>("emptyState");
const propertiesPanel = getElement<HTMLDivElement>("propertiesPanel");
const propertyCount = getElement<HTMLSpanElement>("propertyCount");
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
});
resizeObserver.observe(canvasStage);

async function loadFile(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".riv")) {
    setStatus("文件类型不匹配", "error");
    renderError("请选择 .riv 文件。");
    return;
  }

  setStatus("读取中", "busy");
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
    setStatus("载入失败", "error");
    renderError(error instanceof Error ? error.message : "Rive 文件载入失败。");
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
          reject(new Error("Rive 预览实例未初始化。"));
          return;
        }

        activeRive.resizeDrawingSurfaceToCanvas();
        currentMetadata = collectMetadata(activeRive, currentFile);
        syncControls(currentMetadata, selection);
        renderMetadata(currentMetadata);
        emptyState.hidden = true;
        setControlsEnabled(true);
        setStatus("已载入", "ready");
        resolve();
      },
      onLoadError: (event) => {
        reject(new Error(String(event.data ?? "Rive 文件载入失败。")));
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
  refreshMetadata();
}

function refreshMetadata(): void {
  if (!activeRive || !currentFile) {
    return;
  }

  currentMetadata = collectMetadata(activeRive, currentFile);
  renderMetadata(currentMetadata);
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
        return `${instance.list(property.name)?.length ?? 0} 项`;
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
    motionSelect.append(new Option("无", motionValue({ kind: "none", name: "" })));
    return;
  }

  for (const stateMachine of artboard.stateMachines) {
    motionSelect.append(new Option(`State Machine · ${stateMachine.name}`, motionValue({ kind: "stateMachine", name: stateMachine.name })));
  }

  for (const animation of artboard.animations) {
    motionSelect.append(new Option(`Animation · ${animation}`, motionValue({ kind: "animation", name: animation })));
  }

  if (motionSelect.options.length === 0) {
    motionSelect.append(new Option("静态画板", motionValue({ kind: "none", name: "" })));
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
  propertyCount.textContent = `${countProperties(metadata)} 项`;
  syncPlaybackButton(metadata.runtime);

  propertiesPanel.append(
    renderMetrics(metadata),
    renderArtboards(metadata.artboards, metadata.runtime.activeArtboard),
    renderViewModels(metadata.viewModels, metadata.boundInstance),
    renderDataEnums(metadata.dataEnums),
  );
}

function renderMetrics(metadata: RiveMetadata): HTMLElement {
  const section = createSection("文件");
  const grid = createElement("div", "metrics-grid");

  grid.append(
    createMetric("名称", metadata.fileName),
    createMetric("大小", formatBytes(metadata.fileSize)),
    createMetric("画板", String(metadata.artboards.length)),
    createMetric("stateMachineCount", String(countStateMachines(metadata.artboards))),
    createMetric("ViewModel", String(metadata.viewModels.length)),
    createMetric("Artboard Size", `${formatNumber(metadata.runtime.artboardWidth)} × ${formatNumber(metadata.runtime.artboardHeight)}`),
  );

  section.append(grid);
  return section;
}

function renderArtboards(artboards: ArtboardInfo[], activeArtboard: string): HTMLElement {
  const section = createSection("Artboards");
  const list = createElement("div", "stack");

  if (artboards.length === 0) {
    list.append(createEmptyLine("未读取到 artboard"));
  }

  for (const artboard of artboards) {
    const item = createElement("article", artboard.name === activeArtboard ? "property-card is-active" : "property-card");
    item.append(createCardTitle(artboard.name, artboard.name === activeArtboard ? "active" : ""));
    item.append(renderNameRow("Animations", artboard.animations, "无"));

    const stateMachines = createElement("div", "nested-list");
    if (artboard.stateMachines.length === 0) {
      stateMachines.append(createEmptyLine("无 state machine"));
    }

    for (const stateMachine of artboard.stateMachines) {
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
  }

  section.append(list);
  return section;
}

function renderViewModels(viewModels: ViewModelInfo[], boundInstance: BoundInstanceInfo | null): HTMLElement {
  const section = createSection("View Models");
  const list = createElement("div", "stack");

  if (viewModels.length === 0) {
    list.append(createEmptyLine("未读取到 view model"));
  }

  for (const viewModel of viewModels) {
    const item = createElement("article", "property-card");
    item.append(createCardTitle(viewModel.name, `${viewModel.instanceCount} instances`));
    item.append(renderNameRow("Instances", viewModel.instanceNames, "无命名实例"));
    item.append(createSubhead("Properties"), renderProperties(viewModel.properties));
    list.append(item);
  }

  if (boundInstance) {
    const bound = createElement("article", "property-card highlight");
    bound.append(createCardTitle(boundInstance.name, "auto bound"));
    bound.append(renderProperties(boundInstance.properties));
    list.append(bound);
  }

  section.append(list);
  return section;
}

function renderDataEnums(dataEnums: DataEnumInfo[]): HTMLElement {
  const section = createSection("Data Enums");
  const list = createElement("div", "stack");

  if (dataEnums.length === 0) {
    list.append(createEmptyLine("未读取到 data enum"));
  }

  for (const dataEnum of dataEnums) {
    const item = createElement("article", "property-card");
    item.append(createCardTitle(dataEnum.name, `${dataEnum.values.length} values`));
    item.append(renderNameRow("Values", dataEnum.values, "无"));
    list.append(item);
  }

  section.append(list);
  return section;
}

function renderProperties(properties: PropertyInfo[]): HTMLElement {
  const list = createElement("div", "property-list");

  if (properties.length === 0) {
    list.append(createEmptyLine("无属性"));
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
  propertyCount.textContent = "0 项";
  const card = createElement("div", "empty-card error");
  card.append(createElement("strong", undefined, "载入失败"), createElement("span", undefined, message));
  propertiesPanel.append(card);
}

function renderMetricsPlaceholder(): void {
  propertiesPanel.replaceChildren();
  const card = createElement("div", "empty-card");
  card.append(createElement("strong", undefined, "等待文件"), createElement("span", undefined, "属性会显示在这里"));
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
  const label = runtime?.isPlaying ? "暂停" : "播放";
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

function countProperties(metadata: RiveMetadata): number {
  const inputCount = metadata.artboards.reduce(
    (total, artboard) => total + artboard.stateMachines.reduce((sum, stateMachine) => sum + stateMachine.inputs.length, 0),
    0,
  );
  const viewModelPropertyCount = metadata.viewModels.reduce((total, viewModel) => total + viewModel.properties.length, 0);
  const enumValueCount = metadata.dataEnums.reduce((total, dataEnum) => total + dataEnum.values.length, 0);
  const boundCount = metadata.boundInstance?.properties.length ?? 0;

  return metadata.artboards.length + inputCount + viewModelPropertyCount + enumValueCount + boundCount;
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

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("zh-CN", {
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
