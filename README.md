# Rive Preview

一个用于本地预览和检查 `.riv` 文件的风格化网页工具。界面采用 **Neo-Brutalism + Comic-Pop-Art + Streetwear-Punk** 视觉语言：粗黑描边、高饱和撞色、硬阴影、拼贴感标签和漫画式舞台，让 Rive 文件调试界面更有冲击力。

## 功能

- 左侧上传或拖拽 `.riv` 文件，并在 WebGL2 Canvas 中即时预览。
- 自动加载默认 Artboard，并优先播放第一个 State Machine；没有 State Machine 时播放第一个 Animation。
- 支持切换 Artboard、Playback Source 和 Fit 模式。
- 支持播放 / 暂停当前 Rive 实例。
- 在预览区显示当前 Artboard 的拟合边框，便于判断画布尺寸和裁切关系。
- 右侧属性面板展示 Rive 文件结构和运行态信息。
- 不支持非 `.riv` 文件，错误会直接显示在属性面板中。

## 属性面板

右侧 Inspect 面板会按模块展示当前文件的主要信息：

- **File**：Artboard 数量、State Machine 数量、View Model 数量、当前 Artboard 尺寸。
- **Artboard**：当前 Artboard 名称、Animations、State Machines 及其 Inputs。
- **View Models**：View Model 名称、实例数量、实例名、属性类型；如果自动绑定成功，会显示当前绑定实例的属性值。
- **Data Enums**：枚举名称和枚举值列表。

## 技术栈

- [Bun](https://bun.sh/)：开发服务器和构建工具。
- TypeScript：主逻辑实现。
- `@rive-app/webgl2`：Rive 文件解析、WebGL2 渲染和运行时元数据读取。
- 原生 HTML / CSS：布局、交互控件和 Neo-Brutalism 风格样式。

## 快速开始

安装依赖：

```bash
bun install
```

启动开发环境：

```bash
bun run dev
```

构建生产产物：

```bash
bun run build
```

构建结果输出到 `dist/`。

## 使用方式

1. 打开页面后，点击上传区或将 `.riv` 文件拖入上传区。
2. 在工具栏中选择需要查看的 Artboard。
3. 选择 State Machine、Animation 或静态 Artboard 作为播放来源。
4. 使用 Fit 下拉框切换 `Contain`、`Cover`、`Fill`、`Fit Width`、`Fit Height`、`Scale Down` 或 `None`。
5. 点击播放按钮切换播放和暂停。
6. 在右侧 Inspect 面板查看当前文件的结构化属性。

## 项目结构

```text
.
├── index.html        # 页面结构和控件挂载点
├── src/
│   ├── main.ts       # Rive 加载、预览控制、属性提取和 DOM 渲染
│   └── styles.css    # Neo-Brutalism / Comic-Pop-Art / Streetwear-Punk 样式
├── package.json      # Bun 脚本与依赖
├── tsconfig.json     # TypeScript 配置
└── README.md
```

## 实现说明

上传文件后，应用会读取文件的 `ArrayBuffer`，创建 `RiveFile`，初始化完成后再创建 `Rive` 预览实例。页面通过 `rive.contents`、`viewModelByIndex()`、`enums()` 和 `viewModelInstance` 等运行时 API 收集属性，并根据当前 Artboard、播放源和 Fit 设置刷新预览与右侧面板。

预览实例启用了：

- `autoplay: true`
- `autoBind: true`
- `enableRiveAssetCDN: true`

因此带有外部资源或 View Model 自动绑定的文件可以在支持的情况下直接预览和检查。

## 常见问题

**只能上传 `.riv` 吗？**  
是。当前上传入口只接受 `.riv` 文件，其他文件类型会显示错误。

**为什么有些属性值显示为 `—`？**  
部分 Rive 属性可能没有当前值、读取失败，或属于引用类数据；应用会用 `—`、`reference`、`trigger` 等文本兜底展示。

**为什么预览尺寸和实际 Artboard 不一样？**  
Canvas 会根据当前容器和 Fit 模式缩放渲染。红色虚线框表示当前 Artboard 在舞台中的拟合区域。

**文件会上传到服务器吗？**  
不会。当前实现是在浏览器本地读取文件并交给 Rive WebGL2 运行时处理。
