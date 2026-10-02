# 渲染与视觉系统

Three.js 0.186，WebGL2，`WebGLRenderer`。入口是 `src/render/world.ts`。

## 场景结构

```
Scene
├─ Lighting：DirectionalLight（太阳，阴影 4096²，正交范围 ±150×±100）+ HemisphereLight + 天空球（渐变 shader，r=1500）+ Fog
├─ Terrain.group
│   ├─ 地面 Plane 264×144（264×144 段）：MeshStandardMaterial + onBeforeCompile（领土、云影、战线发光）
│   ├─ 棋盘裙边（沿地形边缘生成，直到 y=−6）+ 底板
│   ├─ 公路（贴合地形的长条，CanvasTexture 画虚线）
│   ├─ 4 个湖（水面 + 沙岸圆盘）
│   ├─ 树（InstancedMesh ≤700，风摆 shader）
│   └─ 价格刻度和数字（每回合 setField 重建）
├─ Bases.group：两端村庄（实例化）、指挥部、旗杆和旗帜（顶点波动）、围栏、发光胜利线、夜间点光源
├─ ArmyRenderer.group：士兵 InstancedMesh(5000)、坦克 InstancedMesh(220)
├─ Effects.group：火焰和烟雾 Points、炮弹、冲击环、闪光灯、曳光弹、碎块、焦痕
└─ CSS2DObject：前线价格标签、储备标签、飘字（DOM，不经过后期处理）
```

## 地形着色器（`terrain.ts`）

| uniform | 作用 |
| --- | --- |
| `uFront` | 战线的 x（来自 `field.x(visualPrice)`） |
| `uAmp`、`uTime` | 战线波动幅度和时间，前线波动函数用 `FRONT_WAVE_GLSL` |
| `uBull/uBullDark/uBear/uBearDark` | 领土颜色。用噪声在深浅色之间混合，靠近战线的地方压暗，像被踩过 |
| `uLine`、`uLineGlow` | 战线发光颜色和强度（每套光照预设不同） |
| `uFlash` | 价格变动时的瞬时闪光，颜色是刚推进的一方，由 `World.setPrice` 触发，衰减速率 2.2 |
| `uCloud` | 云影强度：用两层噪声滚动，压暗漫反射 |

发光公式：`(uLine × (0.75 + 流光脉冲 × 1.1) + uFlash) × 战线宽度 × uLineGlow`，再加上战线两侧很淡的阵营色辉光。流光脉冲沿 z 方向移动，有两个频率。

## 单位着色器（`units.ts`）

- **几何体**：用 `merge()` 拼接盒子，自带 `position`、`normal`、`color`（明暗）、`aPart` 四个属性。

| aPart | 部件 | 动画 |
| --- | --- | --- |
| 0 | 身体、头、头盔、背包 | 无（整体的晃动和倾斜在 CPU 上算） |
| 1 / 2 | 左腿 / 右腿 | 绕髋部（y=0.46）前后摆动，摆幅 = 0.7 × moving，两腿相位相反 |
| 3 | 手臂和步枪 | 后坐：x −0.14 × fire；行军时轻微上下 |
| 4 | 坦克炮塔 | 后坐 x −0.08 × fire |
| 5 | 坦克炮管 | 后坐 x −0.45 × fire |

- **实例属性** `aAnim(vec4)` 的四个分量：

| 分量 | 含义 |
| --- | --- |
| x | 相位种子 |
| y | moving，0–1 |
| z | fire：开火时设为 1，士兵按 7/s、坦克按 2.5/s 衰减 |
| w | 受击闪光：自发光 ×1.4，按 4/s 衰减 |

- 阴影：`customDepthMaterial` 注入同样的顶点变形，所以阴影里的腿也会摆。
- CPU 每帧负责：位置朝目标移动（士兵 7/s，坦克 5/s）、朝向、行军前倾、倒地（绕 z 轴旋转）、下沉、出生时的缩放淡入、撤退时缩小消失。
- 在 `setTargets` 里给每个单位设一个 HSL 微抖动的 instanceColor，让人群看起来不是一片死色。
- **加新部件时**：在 `soldierGeometry()` 或 `tankGeometry()` 里用 `part(geo, 明暗, PART_ID)` 加进去。要新动画，就在 `UNIT_VERTEX_BODY` 里加分支，并把着色器版本、阴影版本和本文档的表一起更新。

## 特效池（`effects.ts`）

| 池 | 容量 | 混合方式 | 说明 |
| --- | --- | --- | --- |
| fire（Points） | 6000 | 加法，`uIntensity` 2.6（HDR） | 爆心、火球、余烬、枪口火光、信号弹、炮弹尾迹 |
| smoke（Points） | 3000 | 普通混合，带风漂移（0.6, 0, 0.25） | 爆炸烟、扬尘、前线硝烟（颜色由光照预设的 `smoke` 决定） |
| 炮弹 | 40 | Basic，颜色 ×5 | 抛物线，弧高 = min(18, 2 + 距离 × 0.18)，飞行时间 = 0.5 + 距离 / 45 |
| 冲击环 | 16 | 加法 | 缓出放大并淡出 |
| 闪光点光源 | 4 | — | 0.35s 平方衰减 |
| 曳光弹 | 240 | 加法 InstancedMesh，颜色 ×4 | 速度 70 单位/s，尾长最多 1.6，命中时出火星 |
| 碎块 | 400 | Standard InstancedMesh | 带重力、能落地反弹，2.2–3.7s 后缩小消失 |
| 焦痕 | 40 | Basic，带 polygonOffset | 每次放置时按 `groundHeight` 重建 6×6 网格贴合地形，25–55s 淡出；池满时复用最旧的 |

粒子是**环形缓冲**，满了就覆盖最旧的。所有数组每帧整体上传，这是已知的性能开销，见下面的「性能」。

## 后期（`post.ts`）

```
RenderPass → HalfFloat 渲染目标（4×MSAA） → UnrealBloomPass → Finish → OutputPass（ACES 色调映射 + sRGB）
```

- `Finish`：
  - **移轴**：屏幕中带 ±0.16 范围清晰，往上下逐渐模糊，用 12 个 Poisson 采样点。模糊半径在电影模式下是 3.2 × 高度/1000，手动模式下是 1.4，两者之间平滑过渡。
  - **调色**：饱和度 1.1，乘上每个预设的色温（warm）。
  - **暗角**。
- 开启后期时会关掉 renderer 自己的 antialias，改用渲染目标的 MSAA。
- 关闭方式：URL `?post=0`，或 `?q=low`（同时关阴影、像素比降到 1）。
- **陷阱**：
  - 开启后期后，色调映射在 OutputPass 里做。自定义 `ShaderMaterial`（天空、粒子）输出的是线性颜色，会被正确转换。如果关掉后期，同样的颜色会显得偏暗，这是已知的不一致。
  - 东西要发光，就把它的颜色或强度提到阈值以上，见 AGENTS.md 第 5 条。

## 光照预设（`lighting.ts → PRESETS`）

| 预设 | 太阳 | 曝光 | 战线发光 | Bloom 强度 / 阈值 | 色温 | 暗角 | 硝烟颜色 | 云影 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `golden` | #ffbf80 ×3.2，低角度 | 1.0 | 1.0 | 0.55 / 1.3 | 1.05, 1.0, 0.92 | 0.34 | #9a8270 | 0.22 |
| `day` | #fff6e8 ×3.4，高角度 | 0.95 | 0.85 | 0.4 / 1.7 | 1, 1, 1 | 0.26 | #a49c92 | 0.25 |
| `night` | #a9c1ff ×1.6（月光） | 1.35 | 0.9 | 0.75 / 1.0 | 0.92, 0.98, 1.1 | 0.42 | #3c4250 | 0.1 |

- `auto` 模式：7–16 点用白天，5–7 点和 16–19 点用黄昏，其余用夜晚。
- 夜间基地点光源强度为 60。

## 镜头（`camera.ts`）

- **手动模式**：OrbitControls，阻尼 0.08，最大俯仰角 1.38，距离 10–340。
  - WASD / 方向键：在水平面上平移，速度和镜头距离成正比。
  - Q / E：绕目标环绕。
  - 鼠标按下、滚轮、WASD 都会退出电影模式。C 键切换电影模式，F 键聚焦前线。
- **电影模式**：按 `overview → frontline → charge → orbit → frontline → base` 循环，每个镜头 8–12 秒。
  - 镜头内的运动用 smoothstep 缓动，位置用指数平滑追随（镜头刚开始时慢一些）。
  - `charge` 镜头会根据价格动量选择从哪一方身后拍。
  - `base` 镜头对准受威胁的那个基地。
  - `focusEvent(p)` 插入 4.5 秒的事件特写（大事件可以打断其他特写）。
  - 叠加轻微的手持漂移（对注视点做低频正弦偏移）。
- **震动**：`shake(amount)`，上限 2.2，按 5/s 指数衰减。
  - 偏移量会在下一帧先减掉，所以不会累积进 OrbitControls 的状态。
  - 触发条件：镜头距着弹点 110 以内，强度 = size × 0.32 × (1 − 距离/110)。

## 性能

- **基准**：Apple M4、Chrome 无头模式、1600×900、像素比 1。实时行情下约 2,000 名士兵加 80 辆坦克，开阴影和后期，跑满 60 FPS。回合切换的瞬间可能降到约 49。
- **主要开销**：
  - 4096² 阴影图
  - 全分辨率 MSAA 和 Bloom
  - 每帧上传 9000 个粒子的属性和约 5000 个实例的矩阵、动画属性
  - CSS2D 飘字（DOM）
- **降级手段**（已有）：`?q=low`、`?post=0`；`DEFAULT_LAYOUT` 的各项上限；士兵总量目标（深度 / 1100）。
- **还没做**（见 backlog）：
  - 只上传有效的粒子区间（`addUpdateRange`）
  - 按设备自动降级
  - 远处单位做 LOD 或改用 billboard
  - 移动端实测

## 新加一种视觉效果的套路

1. 能放进现有池的就放：粒子发射走 `Effects.fire` 或 `Effects.smoke`，一次性网格走 pool。不要每次 `new Mesh`。
2. 要发光就用 HDR 颜色。用三套光照预设分别截图检查，夜晚最容易过曝。
3. 只用传给 `frame(dt)` 的 dt 驱动动画，不要读 `Date.now()`。
4. 跑 `pnpm build && pnpm verify:screens`，看 FPS 和截图。
