# 验证手册

## 1. 自动化

| 命令 | 检查什么 | 通过标准 | 耗时 |
| --- | --- | --- | --- |
| `pnpm build` | 类型检查（tsc strict，`noUnusedLocals/Parameters`）和打包 | 没有报错 | <5s |
| `pnpm test` | 71 个单测（下面有清单） | 全部通过 | <1s |
| `pnpm verify:feeds [秒]` | 用 Node 连真实交易所跑 N 秒（默认 45），输出每家的连接次数、断线、消息数、成交数、盘口档数、价差、相对指数的偏差和权重，并做 6 项断言 | 6 项全部 PASS；报告写入 `verification/feeds-report.json` | N 秒 |
| `pnpm build && pnpm verify:screens` | 启动 vite preview，在无头 Chrome（1600×900）里跑 4 组场景并截图（页面时区固定为 UTC，截图里的时钟不是本机时间）；收集 FPS、单位数、指数、回合、横幅、语言和报错 | 输出 `No runtime errors`（Binance 451 已被过滤，正常情况下现在不应再出现），FPS 和单位数合理，**人工看过截图**；报告在 `verification/screens-report.json` | 约 2 分钟 |
| `pnpm build && pnpm verify:audio` | 无头 Chrome，分三部分：A 允许自动播放时不用点击就出声；B0 喇叭按钮首次解锁、静音与恢复；B1–B7 拦截时提示、点击后出声、激战与胜利切换、M 键、无错误；C 用真实资源离线渲染 36 秒场景（`verification/audio-preview.wav`，不入库），要求不爆音、爆炸比配乐底层高 ≥8 dB | 全部 PASS，并且人工听一遍；公网较慢时还须排除模拟行情状态变化造成的假阴性 | 约 1 分钟 |
| `pnpm build && pnpm verify:mobile` | 无头 Chrome，12 种视口（手机竖屏 5 种含浏览器地址栏后的实际可用高度、手机横屏 3 种、iPad 竖横、1280 笔记本、1440 桌面）× 中英文；先塞满 8 条市场动态和 6 家交易所，再弹出开场横幅，最后显示网络提示（「无法连接到交易所」），测最拥挤的情况。`MOBILE_CHECK_URL=https://<已发布的地址>` 可直接查线上，`MOBILE_CHECK_ONLY=iphone,landscape` 只跑部分视口（不写报告） | 输出 `MOBILE LAYOUT CHECKS PASSED (24)`：各 HUD 块（含左上角品牌和作者 X 链接）互不重叠、都在屏幕内、页面不能横向滚动、没有文字溢出、横幅和网络提示不盖住其他块、动态标签宽度 ≥24px、深度轴三个价格间距 ≥4px、无运行时错误；**人工看过** `verification/mobile/*.jpg`；报告在 `verification/mobile-report.json` | 约 2 分钟 |
| `pnpm capture:fixtures [秒]` | 抓真实消息到 `tests/fixtures/_capture/`（已加入 gitignore） | 各交易所都有样本 | N 秒 |

### `verify:feeds` 的 6 项断言

1. 至少 3 家现货交易所进入指数
2. 进入指数的每家，相对指数偏差都小于 30bp
3. 拿到了 USDT/USD 汇率（来自 Kraken）
4. 至少 3 家盘口在两侧都有超过 20 档
5. 整个过程中没有出现盘口交叉
6. ±1% 聚合深度每一侧都超过 $5M

### `verify:screens` 的场景

| 运行 | URL | 截图 |
| --- | --- | --- |
| `sim` | `?sim&light=golden&seed=11&lang=zh` | 1 电影镜头总览、2 前线近景、3 远景、4 夜晚、5 稍后 |
| `sim-rounds` | `?sim&range=0.06&seed=5&light=day&lang=zh` | 1 等到有一方获胜（`waitFn`）、2 等到下一回合开始 |
| `live` | `?light=golden&lang=en` | 1 总览、2 前线近景、3 白天远景、4 点击语言按钮后（应变成中文） |

截图存为 `verification/<运行>-<编号>.png`，不入库。要长期保留的，用 `sips -s format jpeg` 转成 JPG 放进 `docs/screens/`。

## 2. 单测清单（`tests/`）

| 文件 | 覆盖内容 |
| --- | --- |
| `parsers.test.ts`（18） | OKX：成交、盘口快照和增量（400 档）、ticker 成交额、爆仓过滤和换算（U 本位、币本位、posSide、net 模式）、订阅确认和 pong 被忽略。<br>Coinbase：主动方取反、跳过 last_match、ticker 成交额、level2 快照和增量。<br>Kraken：盘口、成交、两个 ticker（含 USDT/USD）。<br>Bybit：现货三个频道、allLiquidation 方向。<br>Bitstamp：type 0 是买、top100 快照。<br>Binance：真实 aggTrade（m 取反）、depth20 快照、ticker 成交额，forceOrder 方向（合成）。<br>Deribit：真实期权成交、其他币种被忽略、权利金换算。 |
| `market.test.ts`（12） | OrderBook：快照和增量、截断、去交叉。<br>MarketHub：USDT 换算后按成交额加权、离群和过期剔除、大单合并、不同方向和隔太远的成交不合并、爆仓方向、深度分桶和过期盘口剔除、自适应大单阈值（清淡时下降并在转活跃时回升、不越过上下限、不开自适应时固定）。 |
| `battle.test.ts`（12） | BattleEngine：开局、牛方胜、间歇、下一局、熊方胜。<br>narrate：8 种情形。<br>FieldMap：映射和反解、刻度步长、波动有界。<br>layoutArmies：key 唯一、前线/场内/储备拆分、在本方一侧、结果确定、列顺序是排列、niceUsd。 |
| `connectivity.test.ts`（6） | 网络提示判断：离线、启动宽限期、宽限期后没有成交、有现货成交、运行中断流 20 秒、期权成交不算。 |
| `i18n.test.ts`（4） | 两份字典的键集合一致、覆盖所有 StatusKey 和 FeedType、占位符一致、变量替换和切换语言。 |
| `analytics.test.ts`（7） | 访问统计：本地主机一律不加载；没填生产域名时公网主机都加载，填了只认该域名；token 必须是 32 位十六进制；`loadAnalytics` 只在允许时往 head 追加带 token 的脚本。 |
| `audio.test.ts`（12） | 空间化（距离和闷度）、限流、变体不重复、强度和平滑、平静/激战切换滞后、爆炸分级、呼啸对齐、避让深度、资源清单（文件存在、循环参数、变体数）、声音偏好读取。 |

解析器测试读取的是 `tests/fixtures/*.json` 里的真实消息，见 [tests/fixtures/README.md](../../tests/fixtures/README.md)。

## 3. 最新结果

| 日期 | 项目 | 结果 |
| --- | --- | --- |
| 2026-10-02 | `pnpm test` | 60/60 |
| 2026-10-02 | `pnpm build` | 通过。JS 702KB（gzip 187KB），CSS 19KB |
| 2026-10-02 | `verify:feeds 60` | 6/6 PASS。5 家进入指数（Coinbase、Kraken、OKX、Bybit、Bitstamp），偏差 ±1.2bp；指数约 $2,725；±1% 深度买 $26.4M、卖 $24.1M；Binance 451（预期）。窗口内没有 ETH 爆仓和期权成交 |
| 2026-10-02 | `verify:screens` | 11 张截图，0 个非预期错误（只有 Binance 451）。模拟约 900 名士兵 22 辆坦克，实盘约 1,300 名士兵 40 多辆坦克；FPS 32–59（同时在跑其他任务，偏低的几张需要单独复测）；标题、说明文字、中英文切换均为 ETH War。人工看过实盘总览和窄回合胜利两张 |
| 2026-10-02 | `verify:mobile` | 24/24 PASS |
| 2026-10-02 | `verify:audio` | A、B0–B7、C1–C3 全部 PASS；36 个资源，峰值 0.8282，爆炸比配乐底层高 16.2 dB（未人工试听，素材与母项目相同） |
| 2026-10-03 | `pnpm test`、`pnpm build` | 63/63（新增 3 个自适应阈值用例）；构建通过 |
| 2026-10-03 | 实时连接诊断（Node + 无头 Chrome，2026-10-02 22:45 UTC） | 5 家现货在线、指数约 $2,667；120 秒内合并主动单 171 笔，≥$10K 仅 1–2 笔/分钟、≥$5K 2.5 笔/分钟，最长 46 秒无一笔——市场动态空面板的原因 |
| 2026-10-03 | dev 服务器上无头 Chrome 观察 90 秒（自适应阈值） | 门槛从 $10K 降到 $5.3K，流水 5 → 10 条，标题旁显示「≥ $5.3K」，0 个运行时错误 |
| 2026-10-03 | `verify:mobile` | 24/24 PASS；已看 iPhone 竖屏和 Android 横屏截图，新标题不挤 |
| 2026-10-03 | `verify:screens` | 11 张截图全部 60 FPS，0 个非预期错误（只有 Binance 451）；实盘约 1,300 名士兵、50 辆坦克 |
| 2026-10-03 | Binance 451 排查（curl） | `api/stream.binance.com` 在当前网络返回 451（Binance 服务条款的地区限制）；`data-stream.binance.vision`、`fstream.binance.com`、`stream.binance.us` 握手 101 |
| 2026-10-03 | `verify:feeds 60`（现货改连 `data-stream.binance.vision` 后） | 6/6 PASS。**6 家进入指数**（Coinbase、Kraken、OKX、Bybit、Bitstamp、Binance），Binance 权重 47%、偏差 -0.4bp，0 次断线；指数约 $2,667。dev 服务器上无头 Chrome 20 秒内 Binance 两条连接均 open、进入指数、面板显示 47% |
| 2026-10-03 | `pnpm test`、`pnpm build` | 64/64（Binance 解析器改用真实夹具 `binance.json`，forceOrder 仍用合成消息）；构建通过 |
| 2026-10-03（首次提交前） | `pnpm test`、`pnpm build`、`verify:screens`、`verify:mobile` | 64/64；构建通过；11 张截图 0 个非预期错误（Binance 已进入指数，不再有 451），页面时区改为 UTC 后重做了 `docs/screens/` 的 5 张 JPG（实盘 50–60 FPS，模拟 39–54 FPS，当时本机还开着 dev 服务器和浏览器）；24/24 PASS |
| 2026-10-03（访问统计） | `pnpm test`、`pnpm build`、无头 Chrome 端到端 | 71/71；构建通过。用 `--host-resolver-rules` 把一个非本地域名指向本机的生产构建，并拦截对 cloudflareinsights 的请求：`127.0.0.1` 和 `localhost` 下不注入脚本、无请求；非本地域名下 `<head>` 出现带 token 的 beacon 脚本并发起 `beacon.min.js` 请求（已拦截，没有真的上报） |
| 2026-10-03（发布准备） | `pnpm test`、`pnpm build`、`deploy/package.sh`、`deploy/test/rehearse.sh` | 71/71；构建通过；发布包 `ethwar-20261003-0006-18ff777`（64 个文件全部 root:root，无 AppleDouble 文件，`site/` 与 `dist/` 一致，脚本里 token 出现 1 次，36 个音频，8 个图标/manifest/头像）；Docker 演练（Ubuntu 24.04 + nginx，文档专用地址）**REHEARSAL PASSED**，35 项断言全部 ok：预检识别其他站点、部署并记录基线、拒绝重复部署、第二版不重载并回滚、坏配置自动恢复、裸 `listen 443` 被拒绝、证书与 HTTPS、HTTPS 下纯内容发布不重载、回滚字节一致、purge 后指纹与基线一致。没有连生产服务器 |

每次跑完有意义的验证，往这张表里加一行。Bitcoin Battle 时期的历史结果见母项目的同名文档。

## 4. 已知的验证缺口

- **实盘 ETH 爆仓**：从没在窗口内观察到。下次遇到行情波动大时，跑 `pnpm verify:feeds 300`，看「ETH liquidations seen」和流水里有没有 `liqShort/liqLong`，并核对 Bybit 的 `S` 语义。
- **Binance**：现货已改用公开行情主机 `data-stream.binance.vision`，在 `stream.binance.com` 返回 451 的网络下也能连。爆仓流能连但没观察到事件。
- **移动端和低配设备**：布局已由 `verify:mobile` 覆盖（2026-10-02 起全部通过），但真机只有用户 iPhone Chrome 的一张截图（修改前）；iPhone Safari、Android Chrome 真机的性能、触控和发热，以及低配设备均未测。
- **模拟行情不能逐帧复现**：同一个 seed 下，价格路径还受定时器交错顺序影响。需要确定性测试的话，把 SimFeed 改成由外部按步驱动。
- **线上 `verify:audio` 的时间依赖**：A/B2/B3 目前要求恰好处于平静或激战；公网资源加载慢时，模拟回合可能已经切到胜利。固定行情状态后再做断言，避免产品正常却报告失败。

## 5. 人工验收清单（改画面或 HUD 时逐项看）

- [ ] 三套光照下都看一遍：战线清楚但不刺眼；夜晚不过曝；白天白墙不发光
- [ ] 前线两排士兵贴着战线，没有站到对方领土里（被击倒、阵亡的除外）
- [ ] 士兵行军时迈腿，静止时不迈腿；开枪时有后坐和曳光弹
- [ ] 炮击：炮弹有弧线，着地时有爆炸、碎块、焦痕和冲击环；附近的守方士兵被击倒后会爬起来
- [ ] 回合胜利：横幅颜色对、败方旗帜降下后换色再升起、有连环爆炸；6 秒后新回合开始，旗帜复原
- [ ] 中英文切换：所有面板、播报、流水、横幅、3D 标签都跟着变，刷新后还记得选择
- [ ] HUD 文字清楚，没有被价格的发光盖住；播报不来回闪
- [ ] 窗口缩到 860px 宽以下也不错乱
- [ ] 控制台没有新的报错
