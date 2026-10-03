# 会话日志

按时间倒序。每次会话结束时追加一条：做了什么、提交、验证结果、遗留问题。

母项目 Bitcoin Battle（`~/Documents/Bitcoin Battle`）的 18 次会话记录在它自己的 `docs/handoff/session-log.md` 里，这里只记 ETH War。

---

## 2026-10-03 · 会话 4：发布到 ethwar.ondream.ai 的准备（Codex 手册）

- 用户定下线上域名 `ethwar.ondream.ai`（DNS 已生效，DoH 核对过 A 记录），要求准备一份发布手册给 Codex。**本会话没有发布，也没有连过生产服务器。**
- `deploy/` 从母项目 Bitcoin War 当前的 `main` 复制并改名（`battle` → `ethwar`：发布包前缀、站点目录、ACME 目录、Nginx 配置文件名、发布根目录、模板文件名、日志前缀），逻辑一字未改；`deploy/examples/` 用文档专用地址。服务器参数、敏感词清单和带服务器细节的手册放在本机 `private/`（`deploy/site.env`、`deploy/https-listen.conf`、`docs/handoff/{deploy,analytics,README}.md`、`docs/handoff/release-2026-10-03-first.md`）。
- `src/analytics.ts` 的 `ANALYTICS.host` 填为 `ethwar.ondream.ai`（只在生产域名加载 beacon），相关文档随之更新。
- 公开文档：新增 [deploy.md](deploy.md)（机制、安全设计、首次发布的两次重载、回滚）和 [release-and-publish.md](release-and-publish.md)（Codex 通用手册，含首次发布的 `cert` 阶段）；AGENTS.md 加回生产服务器的红线和目录地图；docs/README.md、runbook、backlog 对应更新。
- 验证：见 verification/README.md（单测、构建、`deploy/package.sh` 打包、`deploy/test/rehearse.sh` 本机 Docker 演练）。

---

## 2026-10-03 · 会话 3：访问统计（Cloudflare Web Analytics）

- 用户给了 Cloudflare Web Analytics 的 beacon 片段（ETH War 自己的 token），要求装进站点。照母项目的做法（它的会话 20）做成 `src/analytics.ts`：`shouldLoadAnalytics(hostname, token, host)` 纯函数，token 必须是 32 位十六进制；生产域名还没定，所以 `ANALYTICS.host` 留空，此时只排除本地主机（localhost、127/8、::1、私网地址、`.local`/`.localhost`/`.test`/`.internal`），定了域名再填上只认它。`loadAnalytics()` 在 `main.ts` 最先调用，往 `<head>` 追加 beacon 脚本；本地开发、预览和验证脚本不会上报。
- 这是 ADR 0008 的例外（站点唯一的第三方脚本），已写进 ADR、README「访问统计」、backlog 的部署项（CSP 要放行两个域名）、AGENTS.md 目录地图和 modules.md。三个验证脚本忽略含 `cloudflareinsights` 的控制台错误。
- 新增 `tests/analytics.test.ts`（7 个），共 71 个单测。验证见 verification/README.md。

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
