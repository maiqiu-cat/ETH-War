# 会话日志

按时间倒序。每次会话结束时追加一条：做了什么、提交、验证结果、遗留问题。

母项目 Bitcoin Battle（`~/Documents/Bitcoin Battle`）的 18 次会话记录在它自己的 `docs/handoff/session-log.md` 里，这里只记 ETH War。

---

## 2026-10-03 · 会话 2：市场动态面板长时间没数据 → 大单阈值自适应

- **现象**：用户在 `pnpm dev` 下看实时行情，市场动态面板一直是空的。
- **排查**：Node 和无头 Chrome 各跑了一遍实时连接，5 家现货都在线、指数正常（约 $2,667），不是断线。UTC 22–23 点（2026-10-02）ETH 现货很清淡：120 秒内合并后的主动单共 171 笔，≥$10K 的每分钟只有 1–2 笔，≥$5K 也只有 2.5 笔，最长 46 秒没有一笔；无头 Chrome 里 45 秒才出现第一条流水。
- **改动**：`MarketHub` 新增 `adaptiveBig`（下限、目标频率、回看窗口），阈值取回看窗口内第 k 大的合并金额（k = 目标频率 × 已观察分钟数），再夹在 `[下限, bigTradeUsd]` 之间；`hub.bigTradeUsd` 变成 getter。`main.ts` 默认开启（$2K–$10K、10 笔/分钟、5 分钟），URL `big=N` 固定阈值。HUD 在「市场动态」标题旁显示当前门槛「≥ $X」（`setBigThreshold`，中英文悬停提示 `feedMin.title`）。规则写在 [mapping-rules.md](../game-design/mapping-rules.md)。
- **验证**：单测 63 个（新增 3 个：清淡时下降并在转活跃时回升、不越过上下限、不开自适应时固定）；`pnpm build` 通过；dev 服务器上无头 Chrome 观察 90 秒：门槛从 $10K 降到 $5.3K，流水从 5 条增加到 10 条，无运行时错误；`verify:mobile`、`verify:screens` 结果见 [verification/README.md](../verification/README.md)。
- **遗留**：自适应参数是按清淡时段定的，活跃时段的节奏待观察（backlog）。
- **追加：Binance 为什么一直离线**。用 curl 探测：当前网络下 `api.binance.com` 与 `stream.binance.com`（9443、443）返回 451「Service unavailable from a restricted location according to 'b. Eligibility'」，是 Binance 按服务条款做的地区限制，不是网络故障；`fstream.binance.com`（爆仓流）、`data-stream.binance.vision`（Binance 官方的公开行情专用主机）和 `stream.binance.us` 都能握手。处理：现货合并流改连 `data-stream.binance.vision`（`exchanges.ts`、`capture-fixtures.mjs`），消息格式不变；抓了真实的 Binance 夹具 `tests/fixtures/binance.json` 并让解析器测试改用它。验证结果见 verification/README.md。
- **追加：初始化 git 并公开**。用户要求初始化仓库（名字 ETH-War）、提交，并且不能有任何敏感信息；用户定下中文名「以太坊战争」：页面标题（`app.title`）、manifest 的 `name`/`short_name` 与左上角品牌统一，README 只加了中文名一句，其余按用户决定保持原样。入库前清理：把这两天写进文档的本机网络环境描述改成中性措辞，时间一律写 UTC，本机绝对路径改为 `<项目目录>`，截图脚本固定页面时区为 UTC 并重做 `docs/screens/`，补回会话 1 的标题。公开仓库防线：`scripts/check-public.sh` 补上母项目的 UTC 提交时间检查，敏感词清单从母项目复制到本机 `private/`，`core.hooksPath` 指向 `scripts/git-hooks/`，提交身份 CiCi + noreply 邮箱，`TZ=UTC` 提交。首次提交后建公开仓库 <https://github.com/maiqiu-cat/ETH-War>（关闭 Wiki、`main` 分支保护、Dependabot 告警）并推送。

---

## 2026-10-02 · 会话 1：从 Bitcoin Battle 移植出 ETH War

- **需求**：参照 Bitcoin Battle 实现一版 ETH War，做法照搬。
- **做法**：把 Bitcoin Battle 当时的 `main`（当时的哈希 `a2dc308`，母项目后来重写了历史，该哈希已失效）的源码、测试、脚本、音频管线和文档复制过来，再把标的从 BTC 换成 ETH。没有复制 `.git`、`private/`、`deploy/`（指向母项目的生产站点）、`dist/`、`node_modules/`。
- **数据层**：10 条连接全部改订 ETH。
  - Coinbase `ETH-USD`、Kraken `ETH/USD`（USDT/USD 汇率照旧）、OKX `ETH-USDT`、Bybit `ETHUSDT`（现货 + linear 爆仓）、Bitstamp `ethusd`、Binance `ethusdt`（现货 + forceOrder）、Deribit `trades.option.ETH.100ms`。
  - OKX 永续合约面值：`ETH-USDT-SWAP` 每张 0.1 ETH，`ETH-USD-SWAP` 每张 10 USD。
- **参数**：金额阈值按 ETH 的流量调低，绝对价格的写法改成相对值，对照表在 [mapping-rules.md](../game-design/mapping-rules.md) 末尾。模拟行情起始价 $2,720，数量乘 20，两侧 ±1% 深度约 $25M，和实盘接近。
- **品牌**：标题 ETH War / 以太坊战争（页面标题当时是「以太坊战场」，2026-10-03 统一为「以太坊战争」），`ETH/USD` 说明文字，新图标（战场上方悬浮以太坊菱形，`public/favicon.svg` 及各尺寸 PNG、ICO 由它渲染）。`localStorage` 键改为 `ew.lang`、`ew.sound`，调试入口改为 `window.__ew`。作者 X 链接保留。
- **测试夹具**：2026-10-02 重新抓了 8 份真实 ETH 消息（Deribit 这次抓到了真实期权成交，新增 2 个用例）。单测 60 个。
- **验证**：见 [verification/README.md](../verification/README.md) 的结果表。
- **没有做**：没有初始化 git，没有部署，没有重新生成音频（素材与标的无关，原样沿用）。`LICENSE.md` 的 `Required Notice` 网址从母项目仓库改成了作者主页，等建了仓库再改成仓库地址。
