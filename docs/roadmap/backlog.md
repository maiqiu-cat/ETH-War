# 待办、已知问题、待决问题

最后更新：2026-10-03。做完一项就挪到 [session-log](../handoff/session-log.md)，并在这里划掉或删除。

## 待用户决定（不要自作主张）

| # | 问题 | 背景 |
| --- | --- | --- |
| Q1 | 这个项目的去向：独立发布，还是和 Bitcoin Battle 合并成一个可切换币种的站点？ | 两个项目现在是两份代码（ETH War 从 Bitcoin Battle 复制而来）。合并的话，把标的做成参数即可，差异见 mapping-rules.md 末尾的对照表 |
| Q1b | ~~发布到哪个域名？~~ | 已定：`ethwar.ondream.ai`（2026-10-03，DNS 已生效），发布机制见 [deploy.md](../handoff/deploy.md) |
| Q2 | 是否发布公开演示版、是否商用？ | 尚未发布。正式版需确认各交易所的**数据再分发条款**并做服务端聚合 |
| Q3 | 美术方向：继续程序化低多边形，还是购买或外包 glTF 资源？ | 这是和原版画面差距最大的地方，预计需要 2–4 周或购买资源包 |
| Q4 | 要不要做原版里的 Market chat（市场聊天）？ | 需要账号、后端和内容审核 |

## P0：正式版上线前必须做

- [ ] **服务端聚合服务**（ADR 0002）：
  - 服务端负责连接各交易所、校验盘口（OKX、Kraken 的 checksum 和序列号）、统一计算指数。
  - 通过一条 WS 下发三类数据：指数（几 Hz）、聚合深度分桶（2–4Hz）、事件流。
  - 前端把 `MarketHub` 的输入换成这条下发流，`src/game` 和 `src/render` 不用改。
- [ ] **数据条款审查**：Coinbase、Kraken、OKX、Bybit、Bitstamp、Binance、Deribit 的行情再分发和展示条款。
- [ ] **首次发布到 ethwar.ondream.ai**：发布包、Docker 演练和 Codex 手册 2026-10-03 已备好（[deploy.md](../handoff/deploy.md)、[release-and-publish.md](../handoff/release-and-publish.md)），等用户授权执行。以后给 Nginx 加 Content-Security-Policy 时要放行 `static.cloudflareinsights.com`（脚本）和 `cloudflareinsights.com`（beacon 上报）。可以参照母项目 Bitcoin Battle 的 `deploy/` 和 `docs/handoff/deploy.md`，换成自己的域名和站点目录后再用。

## P1：验证缺口和稳定性

- [ ] **金额阈值按实盘再校准**：特写 $125K/$300K 等是按「ETH 流量约为 BTC 一半」估的（见 mapping-rules.md 末尾对照表）。大单门槛 2026-10-03 已改成自适应（$2K–$10K、目标 10 笔/分钟），参数是按 UTC 22–23 点的清淡时段定的；活跃时段再看炮击密度和面板节奏是否合适。
- [ ] **ETH 期权事件偏少**：Deribit ETH 期权单笔权利金小，60 秒窗口内常常没有 ≥$500 的成交。

- [ ] **观察到实盘 ETH 爆仓**：跑 `pnpm verify:feeds 300`，或者等行情剧烈时跑。核对 Bybit `allLiquidation` 里 `S=Buy` 是否真的表示多头被爆（拿价格方向和 OKX 的 posSide 交叉验证）。核对完更新 `exchanges.md`。
- [ ] **Binance forceOrder 出事件**：现货已通过 `data-stream.binance.vision` 进入指数（2026-10-03）；`fstream` 一直能连，但还没在窗口内看到 ETH 爆仓。另外留意 `.vision` 主机会不会哪天也开始 451。
- [ ] **盘口校验**：OKX 用 `checksum` 和 `seqId/prevSeqId`，Kraken 用 CRC32 checksum。校验失败就重新订阅。
- [ ] **Bitstamp 冷启动权重偏低**：可以先给一个 24h 成交额的先验值，或者等滚动窗口满了再纳入指数。
- [ ] **模拟行情不确定**：把 `SimFeed` 改成由外部按步驱动，做到逐帧可复现，方便视觉回归测试。
- [ ] **线上音频验收脚本去除时间依赖**：`verify:audio` 的 A/B2/B3 假设资源加载完时模拟行情仍在平静阶段；公网加载较慢时可能已经激战或胜利。固定模拟速度与回合范围，或在检查前强制受控状态。

## P1：性能和适配

- [ ] **移动端实测**：布局沿用母项目（`verify:mobile` 24/24），待发布后在 iPhone Safari、Android Chrome 真机上看性能、触控和发热，并按设备自动选 `q=low`。
- [ ] **竖屏镜头取景**：手机竖屏的水平视角只有约 25°，只看得到战场中段，两端基地常在屏幕外。可以按宽高比加大竖屏的视角或拉远镜头（需要先看效果再定）。
- [ ] **粒子只上传有效区间**：用 `BufferAttribute.addUpdateRange`。现在每帧上传 9000 个粒子的全部属性。
- [ ] **远处单位 LOD**：改用点精灵或 billboard，以及按距离剔除。
- [ ] **页面不可见时降频或暂停渲染**（`visibilitychange`）。
- [ ] **CSS2D 飘字改成对象池**：现在每次都新建 DOM 节点。

## P2：画面和玩法（向原版靠拢）

- [ ] **更有机的前线形状**：按 z 方向的局部深度起伏，而不只是正弦波（见 ADR 0004）。
- [ ] **美术资源**：士兵、坦克、建筑的 glTF，骨骼动画或 VAT（见 ADR 0005）。
- [ ] **天气系统**：原版左上角有「Clear」选项，可以加雨、雾、雪。
- [ ] **按交易所区分兵种或徽章**；点击单位显示对应挂单的价格和金额。
- [ ] **回合宽度随波动率自适应**（现在固定 ±0.25%）。
- [ ] **回合历史面板**：最近 20 回合的胜方、用时、最大推进。
- [x] ~~**声音**~~：会话 8 完成（程序化合成）。后续可选：换成专业录音素材、分开调音乐和音效音量的面板、天气环境音。
- [ ] **镜头脚本可配置**；录制或分享短视频（`MediaRecorder`）。

## 已知问题（目前可接受）

| 问题 | 影响 | 位置 |
| --- | --- | --- |
| 关掉后期（`post=0`）时，天空和粒子颜色偏暗 | 只出现在低配模式 | ADR 0007 |
| 窄回合（如 `range=0.06`）下，储备标签显示的兵数很大（上万） | 只是显示 | `world.setLayout` |
| 阵亡单位会在原地躺 2 秒，然后消失 | 设计如此 | `units.ts` |
| 截图验证的 FPS 会受同时打开的浏览器标签页影响 | 测量误差 | `verify:screens` |
| 首个回合要等指数出来，约 1–2 秒，期间场上为空 | 体验 | `main.ts` |
| HUD 是手写 DOM，状态同步靠 `applyLang()` 等手动调用 | 维护成本 | ADR 0001 |
