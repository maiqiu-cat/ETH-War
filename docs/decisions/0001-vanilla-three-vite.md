# 0001：纯 Three.js + Vite + TypeScript

- 状态：采用（2026-10-01）

## 背景

目标是尽快验证「把行情映射成 3D 战场」可不可行，并能在 M 系 Mac 上流畅运行。备选方案有 React Three Fiber、Babylon.js、Unity WebGL 和 PlayCanvas。

## 决定

用 Vite 8、TypeScript 7（strict）和 three 0.186，不用 UI 框架。HUD 是手写 DOM，模板字符串加 `data-k` 引用。

## 后果

- 依赖少（运行时只有 three 和字体），打包后 JS gzip 约 178KB，冷启动快。
- 着色器注入（`onBeforeCompile`）、实例化、后期都能直接控制。
- HUD 没有组件化，状态同步靠手写，`applyLang()` 就是例子。HUD 继续变复杂的话，代码会难以维护。

## 何时重新评估

- 需要大量交互面板（设置页、聊天、账号）时，可以考虑把 HUD 换成轻量框架（如 Preact、Solid），3D 部分保持不动。
- 要用骨骼动画模型，以及大量 glTF 资源管理时，评估是否引入资源管线（如 gltf-transform）。
