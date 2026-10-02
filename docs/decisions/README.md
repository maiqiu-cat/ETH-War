# 架构决策记录（ADR）

每条记录写清楚：当时的背景、做了什么决定、带来什么后果、什么时候应该重新评估。想推翻某个设计之前，先读对应的 ADR；推翻之后，新建一条 ADR，把旧的状态改成「已被 XXXX 取代」。

| 编号 | 决策 | 状态 |
| --- | --- | --- |
| [0001](0001-vanilla-three-vite.md) | 纯 Three.js + Vite + TS，不用 React 和游戏引擎 | 采用 |
| [0002](0002-browser-direct-feeds.md) | 原型阶段由浏览器直连交易所，不建后端 | 采用（原型），生产要换 |
| [0003](0003-index-methodology.md) | 指数 = 最新成交价按 24h 成交额加权，USDT 先换算，剔除偏离 0.5% 的交易所 | 采用 |
| [0004](0004-depth-to-armies.md) | 深度到兵力：前线排、方阵、坦克、储备，key 稳定 | 采用 |
| [0005](0005-instanced-units-shader-anim.md) | 单位用 InstancedMesh，肢体动画放在顶点着色器里 | 采用 |
| [0006](0006-i18n-keys.md) | 逻辑层只产出 i18n 键，不产出文案；中英两份字典由测试保证一致 | 采用 |
| [0007](0007-hdr-postprocessing.md) | HDR 后期（Bloom、移轴），发光靠提高颜色亮度，不靠降低阈值 | 采用 |
| [0008](0008-local-assets-no-cdn.md) | 字体等资源本地打包，不依赖 Google Fonts 和 CDN | 采用 |
