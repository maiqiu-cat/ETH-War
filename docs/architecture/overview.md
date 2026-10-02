# 架构总览

## 分层

```
┌──────────────────────────────── 浏览器（纯前端，无后端） ─────────────────────────────────┐
│                                                                                       │
│  交易所 WebSocket ×10 条连接                                                           │
│    Coinbase(2) Kraken OKX Bybit(2) Bitstamp Binance(2, 当前被 451) Deribit             │
│        │  WsFeed：重连 / 心跳 / 看门狗                                                  │
│        ▼  parseXxx(msg)（纯函数）→ ParsedEvents                                        │
│  ┌────────────┐   trade/book/ticker/liquidation/usdtUsd/status   ┌──────────────────┐   │
│  │ SimFeed    │ ───────────────────────────────────────────────► │ MarketHub        │   │
│  │ (?sim)     │                                                  │ (FeedSink 实现)   │   │
│  └────────────┘                                                  │ · 各家 OrderBook  │   │
│                                                                  │ · 指数/24h 开盘   │   │
│                                                                  │ · 大单合并 → 事件 │   │
│                                                                  │ · 深度分桶/流量   │   │
│                                                                  └───────┬──────────┘   │
│                         ┌────────────────── main.ts（250ms tick）────────┤              │
│                         ▼                                               │ onEvent       │
│  src/game（纯逻辑）  BattleEngine ── FieldMap ── layoutArmies ── narrate   │              │
│                         │                                               │              │
│                         ▼                                               ▼              │
│  src/render         World（每帧）：Terrain · ArmyRenderer · Effects · Bases ·            │
│                     Lighting · CameraRig · PostFX · CSS2D 标签                          │
│  src/ui             Hud（DOM 覆盖层，每帧补间）· i18n                                    │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- **数据层 `src/data`**：只负责把各交易所消息统一成 `Trade / BookUpdate / TickerUpdate / Liquidation`，再在 `MarketHub` 里汇总。这一层不依赖 three 和 DOM，Node 里也能跑，`scripts/verify-feeds.ts` 就是这样用的。
- **逻辑层 `src/game`**：纯函数和普通类，输入行情，输出回合状态、坐标映射、单位目标位置、播报键。全部有单测。
- **表现层 `src/render` 和 `src/ui`**：只读逻辑层的输出。渲染和 HUD 自己的状态（动画、补间）都留在本层。
- **装配 `src/main.ts`**：读取 URL 参数，创建以上对象，驱动两个循环。

## 运行循环

| 循环 | 周期 | 位置 | 做什么 |
| --- | --- | --- | --- |
| 逻辑 tick | 250ms | `main.ts → tick()` | 见下表 |
| 渲染帧 | rAF，dt 上限 0.05s | `main.ts → frame()` | `world.frame(dt)`，然后 `hud.frame(dt)` |
| 事件 | 推送式 | `hub.onEvent` | `hud.addFeed` 和 `world.onMarketEvent`，后者受「特效预算」限制：最多 6 个令牌，每 400ms 补 1 个；金额 ≥$250K 的事件不受限 |
| 自动光照 | 60s | `main.ts` | `light=auto` 时按本地时间切换光照预设 |
| 连接看门狗 | 5s | `WsFeed` | 超过 `staleMs`（默认 45s）没收到消息就断开重连 |

### `tick()` 的步骤

1. 调用 `hub.tick()`：结算超过 150ms 的大单合并、计算指数、每 250ms 采样一次价格（保留 15 分钟）、每 5s 剪掉离中价超过 5% 的盘口档位。
2. 调用 `battle.update(price, now)`，可能得到两种事件：
   - `start`：新建 `FieldMap`，调用 `world.setRound`（重建价格刻度、重置旗帜），重算兵力单价，显示「战斗开始」横幅。
   - `win`：显示胜利横幅，调用 `world.celebrate`（夺旗动画加连环爆炸）。
3. 计算兵力：
   - 分桶宽度 = 场地价格跨度 / 110。
   - 取 ±1% 的聚合深度，调用 `layoutArmies`，结果交给 `world.setLayout`。
   - 兵力单价 `usdPerSoldier = niceUsd(单侧场内深度 / 1100)`。只有新值和当前值相差 2.5 倍以上才重设，避免方阵频繁重排。
4. 生成战况播报：
   - 近端深度取价格 ±0.06% 内的挂单。
   - 和 10 秒前的近端深度、20 秒前的进度、20 秒内的主动买卖流量比较，交给 `narrate()` 得到一个状态键。
   - HUD 会做防抖，见 UI 文档。
5. 按最近 5 秒的买卖流量调用 `world.setActivity`，它决定前线对射的频率和战线波动幅度。
6. 画深度图：每个 tick 都画，范围是价格 ±range×1.6，数据源可以在面板里选。
7. 每秒更新一次：±1% 流动性、交易所状态面板、深度图数据源下拉框、市场状态。市场状态按 5 分钟已实现波动率划分：低于 0.03% 为平静，低于 0.08% 为活跃，以上为剧烈。

### `World.frame(dt)` 的顺序

1. 让 `frontPrice` 以速率 4 指数逼近目标价，战线因此平滑移动。
2. 更新地形 uniform：时间、波动幅度、前线 x、价格变动闪光（衰减速率 2.2）。
3. 前线对射：频率 = `min(26, 3 + log10(1 + 每秒流量) × 3.5)` 次/秒。
4. 每 0.16 秒在前线附近生成一团硝烟。
5. 播放庆祝爆炸队列。
6. 更新兵力（`ArmyRenderer.update`）、特效、旗帜。
7. 更新前线价格标签的位置，再更新镜头（`CameraRig.update`）。
8. 渲染：有后期就走 `PostFX.render`，否则直接用 `renderer.render`。最后渲染 CSS2D 标签。

## 坐标系

| 量 | 值 | 定义位置 |
| --- | --- | --- |
| x 轴 | 价格轴。低价（买盘、牛方）在 −x，高价（卖盘、熊方）在 +x | `FieldMap` |
| 场地宽、深 | 220（x）× 120（z） | `FIELD_WIDTH/DEPTH` |
| 场地价格范围 | `[bearsWinAt − 0.2R, bullsWinAt + 0.2R]`，R = 回合价格跨度 | `BASE_MARGIN` |
| 基地（胜利线）x | 牛方 −78.57，熊方 +78.57，每回合固定不变 | `BULL_BASE_X / BEAR_BASE_X` |
| 棋盘 | 264 × 144，底座厚 6 | `BOARD_W/BOARD_D` |
| 公路 | z = 7 | `ROAD_Z` |
| 地面高度 | `groundHeight(x, z)`：起伏地形，在公路、湖、棋盘边缘处压平 | `render/terrain.ts` |
| 前线 | `x = field.x(visualPrice) + frontWave(z, t, amp)` | `World.frontX` |
| y | 向上；士兵高约 1.2，坦克长约 2.4 | — |

- **注意 1**：牛方的目标是「熊方基地」，它在高价那一端（+x）。价格涨到 `bullsWinAt` 就算牛方获胜。
- **注意 2**：`visualPrice` 被限制在场地范围内。回合结束后价格可能冲出场地，但战线不会画到棋盘外面。

## 状态归属

| 状态 | 归属 | 说明 |
| --- | --- | --- |
| 盘口、成交、指数、事件流 | `MarketHub` | 唯一事实来源 |
| 回合、比分 | `BattleEngine` | `history` 保留 20 回合 |
| 单位实体（位置、动画相位） | `ArmyRenderer.units: Map<key, Unit>` | key 来自 `layoutArmies`，稳定不变，所以单位能持续存在、走到新位置 |
| 镜头模式和镜头脚本 | `CameraRig` | 鼠标、滚轮、WASD 操作会退出电影模式 |
| 语言 | `i18n.ts` 模块级变量，写入 `localStorage: ew.lang` | `onLangChange` 广播 |
| 光照 | `main.ts: lightingChoice` | 下拉框和 URL 参数 `light` 都会改它 |

## 调试入口

页面上挂了一个 `window.__ew = { hub, battle, world, stats, sim, army() }`，供 `scripts/screenshot.mjs` 读取 FPS、单位数、指数和回合。在控制台里也能直接用，例如 `__ew.world.rig.setCinematic(false)`。
