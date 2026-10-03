# 模块参考（逐文件）

行数和导出以 2026-10-01 的 `main` 为准。改了接口请同步更新本文件。

## src/data：行情

| 文件 | 职责 | 关键导出 | 备注 |
| --- | --- | --- | --- |
| `types.ts` | 统一的数据类型 | `ExchangeId` `Trade` `Liquidation` `BookUpdate` `TickerUpdate` `FeedSink` `ParsedEvents` `Level` | `Trade.side` 一律是**主动方（taker）**。`Trade.price` 用交易所自己的计价货币，USDT 价格由 MarketHub 换算成 USD。期权成交的 `price` 是标的指数价，`premiumUsd` 是权利金。 |
| `feeds/wsFeed.ts` | 一条 WebSocket 连接的生命周期 | `WsFeed` `WsFeedOptions` `dispatch` | 指数退避重连（1s×2ⁿ，上限 60s，±25% 抖动）、ping、服务端心跳应答（`reply`）、看门狗（`staleMs`）。有诊断字段 `connects`、`errorLog`、`messages`。浏览器和 Node ≥22 都能用。 |
| `feeds/exchanges.ts` | 各交易所解析器和连接配置 | `parseCoinbase` `parseCoinbaseL2` `parseKraken` `parseOkx` `parseBybitSpot` `parseBybitLiq` `parseBitstamp` `parseBinance` `parseDeribit` `feedOptions()` `createFeeds()` `ALL_SOURCES` | 解析器都是纯函数，测试在 `tests/parsers.test.ts`。连接配置见 `feedOptions()`。逐家细节见 [exchanges.md](../data-sources/exchanges.md)。 |
| `orderbook.ts` | 单个交易所的 L2 盘口 | `OrderBook` | 数据结构是 `Map<price, sizeETH>`。支持快照和增量；`truncate(depth)` 只保留最优 N 档；`prune(mid, pct)` 剪掉远端档位；`uncross` 删除没更新的那一侧的交叉档位。 |
| `market.ts` | 行情中枢 | `MarketHub` `DEFAULT_MARKET_CONFIG` `FeedItem` `FeedType` `IndexResult` `DepthBuckets` | 实现 `FeedSink` 接口。主要方法：`computeIndex()`、`depth()`、`liquidity()`、`flow()`、`priceAgo()`、`realizedVolPct()`、`onEvent()`、`tick()`。时钟可以注入（构造参数 `now`），方便测试。 |
| `connectivity.ts` | 网络提示的判断 | `netState` `NetState` `NET_GRACE_MS` `NET_QUIET_MS` | 纯函数：浏览器离线 → `offline`；启动 12 秒内还没有成交 → `checking`（不提示）；现货交易所 20 秒内有过成交 → `ok`；否则 → `unreachable`。Deribit 期权成交不算。`main.ts` 只在实时模式下每秒调用一次，并监听 `online` 和 `offline` 事件。 |
| `src/analytics.ts` | Cloudflare Web Analytics 的 beacon 加载 | `shouldLoadAnalytics` `loadAnalytics` `ANALYTICS` | `shouldLoadAnalytics(hostname, token, host)` 是纯函数：token 必须是 32 位十六进制；`host`（`ethwar.ondream.ai`）填了就只认它，没填就排除本地主机（localhost、127/8、::1、私网地址、`.local`/`.test` 等）。`loadAnalytics()` 在 `main.ts` 最先调用，往 `<head>` 追加 beacon 脚本。token 是公开的站点标识，直接写在代码里。 |
| `sim.ts` | 离线模拟行情 | `SimFeed` `mulberry32` | 和真实适配器走同一个 `FeedSink`。价格是随机游走加偶发趋势；盘口每 250ms 发一次快照，含挂单墙；会产生成交（偶尔巨鲸单）、爆仓和期权成交。时间相关，同一个 seed 也不保证完全复现。 |

## src/game：纯逻辑（不准引入 three 或 DOM）

| 文件 | 职责 | 关键导出 | 备注 |
| --- | --- | --- | --- |
| `battle.ts` | 回合、胜负、战况播报 | `BattleEngine` `Round` `narrate()` `StatusKey` `NarrationInput` | 默认 `halfRange` 0.25%、`intermissionMs` 6000、`history` 20 条。`narrate()` 返回 i18n 键，不返回文案。 |
| `field.ts` | 价格到战场坐标的映射 | `FieldMap` `FIELD_WIDTH` `FIELD_DEPTH` `BASE_MARGIN` `frontWave()` `FRONT_WAVE_GLSL` | `frontWave` 和 GLSL 版本必须同步。`tickStep()` 用来选价格刻度的间距。 |
| `armies.ts` | 深度到单位目标位置的布局 | `layoutArmies()` `DEFAULT_LAYOUT` `niceUsd()` `hash01()` `frontColumnOrder()` | 输出 `UnitTarget{key, team, kind, x, z, frontRow?}`。key 稳定，所以单位能持续存在。规则见 [mapping-rules.md](../game-design/mapping-rules.md)。 |

## src/render：Three.js

| 文件 | 职责 | 关键导出 | 备注 |
| --- | --- | --- | --- |
| `world.ts` | 场景总装和每帧驱动 | `World` `WorldOptions{shadows, pixelRatio, post}` | 主要方法：`setRound`、`setPrice`、`setLayout`、`setActivity`、`onMarketEvent`、`celebrate`、`setLighting`、`frame`。还负责前线对射、硝烟、震屏判定和 CSS2D 标签。 |
| `terrain.ts` | 棋盘地形 | `Terrain` `groundHeight()` `BOARD_W/D` `ROAD_Z` `BULL/BEAR_BASE_X` `LAKES` `mergeSimple()` | 地面材质通过 `onBeforeCompile` 注入领土着色、云影、战线发光、流光脉冲和闪光。棋盘侧面是沿地形边缘生成的「裙边」。树做了实例化，带风摆。`setField()` 重建价格刻度。 |
| `units.ts` | 士兵和坦克 | `ArmyRenderer` `Unit` | 士兵最多 5000、坦克最多 220 个实例。每个单位有四种阶段：`alive`、`knocked`、`dying`、`retreating`。顶点着色器负责摆腿和后坐，`customDepthMaterial` 让阴影也跟着动。回调：`onKilled`、`onDust`。 |
| `effects.ts` | 特效池 | `Effects` | 包括：火焰粒子（6000，加法混合，HDR×2.6）、烟雾粒子（3000）、炮弹（40）、冲击环（16）、闪光灯（4）、曳光弹（240，实例化）、碎块（400，实例化）、焦痕（40，贴合地形）。 |
| `bases.ts` | 两端基地 | `Bases` `TEAM_COLORS` `BASE_CENTER` | 村庄做了实例化，另有指挥部、旗帜（顶点波动）、围栏、发光胜利线、夜间点光源。夺旗动画：`capture(loser, winner)` 降旗、换色、升旗；`reset()` 恢复原色。 |
| `lighting.ts` | 光照预设和天空 | `Lighting` `PRESETS` `autoLighting()` `LightingName` | 三套预设 `golden`、`day`、`night`，每套同时包含后期参数（泛光、调色、暗角）、硝烟颜色和云影强度。 |
| `camera.ts` | 镜头 | `CameraRig` `DirectorContext` | 手动模式用 OrbitControls，加 WASD 和 Q/E。电影模式有 6 种镜头轮换，大事件时切特写（`focusEvent`），另有 `shake()` 和手持感漂移。 |
| `post.ts` | 后期处理 | `PostFX` | 顺序：RenderPass(4×MSAA, HalfFloat) → UnrealBloom → Finish（移轴、饱和度、色温、暗角）→ OutputPass。用 `setCinematic()` 切换移轴强度。 |

## src/audio：配乐和音效（详见 [docs/audio/README.md](../audio/README.md)）

| 文件 | 职责 | 关键导出 | 备注 |
| --- | --- | --- | --- |
| `mix.ts` | 纯逻辑 | `spatial` `VoiceLimiter` `VariantPicker` `musicIntensity` `smoothIntensity` `MusicModeSwitch` `explosionTier` `whistleOffset` `duckFor` | 有单测：`tests/audio.test.ts` |
| `engine.ts` | 引擎 | `AudioEngine`（`boot` `unlock` `toggle` `setActivity` `frame` `rifle` `cannon` `explosion` `whistle` `flare` `horn` `fanfare` `debugForce`）、`buildGraph` `playBuffer` `duckMusic` `loadBuffers` `readSoundPref` `renderPreview` | 通过 `import.meta.glob` 拿到带哈希的资源 URL；`MusicPlayer` 负责平静和激战的交叉淡变以及胜利段 |
| `instruments.ts` | UI 点击音（合成） | `click` | — |
| `assets/` | 预渲染资源 | `manifest.json`、36 个 `.m4a` | 由 `tools/audio/build_assets.py` 生成，不要手改 |

## src/ui

| 文件 | 职责 | 关键导出 | 备注 |
| --- | --- | --- | --- |
| `hud.ts` | DOM 覆盖层 | `Hud` `HudCallbacks` `BannerSpec` | 元素通过 `data-k` 引用，`data-i18n` 是静态文案，`data-i18n-title` 是悬停提示。`frame(dt)` 做数字补间。状态播报有防抖。`showBanner()` 接收的是 i18n 键加变量。`setNet(state)` 显示或隐藏网络提示 `.net-alert`。作者 X 链接的地址和昵称在 `X_PROFILE`，头像是 `public/x-avatar.jpg`。 |
| `i18n.ts` | 中英文字典 | `t()` `setLang()` `getLang()` `onLangChange()` `DICTIONARIES` `Lang` | 语言取值优先级：URL `lang` → `localStorage['ew.lang']` → `navigator.language`。 |
| `format.ts` | 格式化 | `fmtUsd` `fmtPrice` `fmtTime` | — |
| `styles.css` | 全部样式 | — | CSS 变量 `--bull` `--bear` `--panel` `--ease`。适配 `prefers-reduced-motion`，宽度 ≤860px 时用窄屏布局。 |

## 其他

| 路径 | 说明 |
| --- | --- |
| `src/main.ts` | 读取 URL 参数，完成装配，运行逻辑 tick 和渲染帧，挂调试入口 `window.__ew`。URL 参数表见根目录 README。 |
| `index.html` | 只有 `#app`（画布）和 `#hud`（覆盖层）两个容器。favicon 是内联 SVG。 |
| `vite.config.ts` | `test.include = tests/**/*.test.ts`，Vitest 运行环境是 `node`。 |
| `pnpm-workspace.yaml` | `allowBuilds: { esbuild: true }`，删掉 tsx 就跑不起来。 |
