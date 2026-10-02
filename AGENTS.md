# AGENTS.md：编程 agent 接手指南

所有编程 agent（Claude Code、Codex 等）接手本项目时先读本文件。它只放「必须知道的事」，细节都在 `docs/` 里有链接。

## 1. 项目一句话

**ETH War**，中文名**「以太坊战争」**（页面标题、manifest 和左上角品牌统一用这两个名字，不要再出现别的名字）：把实时 ETH 行情做成 3D 牛熊战场。它是 Bitcoin Battle（Newhedge「Bitcoin Battlefield」的复刻，`~/Documents/Bitcoin Battle`）的 ETH 版，2026-10-02 从母项目复制而来，玩法、画面、音频完全相同，只换了标的和金额阈值。

- **价格**：跨交易所按成交量加权聚合出一个价格，它就是战线。
- **兵力**：盘口挂单换算成士兵和坦克。
- **炮击**：大额主动成交、爆仓、期权大单会变成战场上的炮击。
- **胜负**：价格打到对方基地，这一回合就结束。

技术栈：Vite 8、TypeScript 7（strict）、Three.js 0.186，纯前端，没有后端。界面支持中文和英文。

- 本地路径：用户本机的 ETH War 目录（目录名带空格，在 shell 里要加引号；下文记作 `<项目目录>`）
- 许可：[PolyForm Noncommercial 1.0.0](LICENSE.md)，可以复制、分发、修改，不可以商用；第三方组件见 CREDITS.md。改许可证由用户决定
- 远端：<https://github.com/maiqiu-cat/ETH-War>（**公开**，只有 `main`）。推送前必须通过 `pnpm check:public`，不要 force push、不要推 `main` 以外的分支或 tag。没有部署，发布到哪里由用户决定（见 backlog 的「待用户决定」）

## 2. 阅读顺序

1. 本文件
2. [docs/handoff/session-log.md](docs/handoff/session-log.md)：做过什么、现在停在哪
3. [docs/roadmap/backlog.md](docs/roadmap/backlog.md)：待办、已知问题、需要用户拍板的问题
4. [docs/architecture/overview.md](docs/architecture/overview.md)：数据流和运行循环
5. 按任务去读对应专题：

| 任务 | 文档 |
| --- | --- |
| 改数据源或指数 | [docs/data-sources/](docs/data-sources/README.md) |
| 改玩法规则或参数 | [docs/game-design/mapping-rules.md](docs/game-design/mapping-rules.md) |
| 改画面或性能 | [docs/rendering/visual-system.md](docs/rendering/visual-system.md) |
| 改 HUD 或多语言 | [docs/ui/hud-and-i18n.md](docs/ui/hud-and-i18n.md) |
| 改完怎么验收 | [docs/verification/README.md](docs/verification/README.md) |
| 和 Bitcoin Battle 的差异 | [docs/game-design/mapping-rules.md](docs/game-design/mapping-rules.md) 末尾的对照表 |

全部文档索引：[docs/README.md](docs/README.md)

## 3. 常用命令

```bash
cd "<项目目录>"
pnpm install
pnpm dev                       # http://localhost:5173（离线模拟：/?sim）
pnpm test                      # Vitest 单测（71 个）
pnpm build                     # tsc --noEmit + vite build
pnpm verify:feeds [秒]         # Node 里跑真实交易所连接并做断言，默认 45 秒
pnpm verify:screens            # 先 build；无头 Chrome 截图，收集 FPS 和报错
pnpm capture:fixtures [秒]     # 抓真实消息到 tests/fixtures/_capture/（不覆盖现有夹具）
pnpm build && pnpm verify:audio  # 音频检查：自动播放、点击解锁、平静/激战/胜利切换、M 键、离线渲染试听
pnpm build && pnpm verify:mobile # 12 种手机/平板/电脑尺寸 × 中英文：HUD 互不遮挡、不出界、文字不溢出
```

- macOS 没有 `timeout` 命令。需要给命令限时的话，用 `perl -e 'alarm 120; exec @ARGV' <cmd>`。
- `verify:screens` 默认用 `/Applications/Google Chrome.app`，可以用环境变量 `CHROME=` 覆盖。

## 4. 目录地图

```
src/data/       行情：交易所解析与连接、订单簿、MarketHub（指数、事件、深度）、模拟行情
src/game/       纯逻辑：回合与播报、价格→坐标、深度→兵力布局（全部可单测，不依赖 DOM 和 three）
src/render/     Three.js：World 总装、地形、兵力、特效、基地、光照、镜头、后期
src/ui/         HUD、i18n 字典、格式化
src/audio/      音频引擎；src/audio/assets/ 是预渲染的配乐和音效（m4a + manifest.json），见 docs/audio/README.md
tools/audio/    生成配乐和音效的 Python 管线（MuseScore_General 音色库，MIT），见 tools/audio/README.md
src/main.ts     装配与循环（250ms 逻辑 tick + 每帧渲染）
src/analytics.ts  Cloudflare Web Analytics 的 beacon，本地主机不加载，生产域名定了填 ANALYTICS.host（ADR 0008 的例外）
tests/          Vitest；tests/fixtures/ 是 2026-10-02 抓到的真实 ETH 交易所消息
scripts/        verify-feeds.ts、screenshot.mjs、capture-fixtures.mjs、check-public.sh（推送前的敏感信息检查）、git-hooks/（core.hooksPath）
（没有 deploy/：母项目的发布脚本指向它自己的生产站点，没有复制过来）
verification/   脚本输出的报告（JSON 入库，PNG 不入库）
docs/           全部开发文档（见 docs/README.md）
```

## 5. 硬性约定

1. **解析器必须是纯函数**：`parseXxx(msg) → ParsedEvents | null`，并且要有基于真实消息的测试。新增或修改交易所时，先用 `pnpm capture:fixtures` 抓样本。
2. **界面文案不写死**：一律用 `t('key')`，`zh` 和 `en` 两份字典都要补齐。`tests/i18n.test.ts` 会检查两边键集合和占位符是否一致。逻辑层只返回键，例如 `narrate()` 返回 `StatusKey`，`FeedItem.type` 也是键。
3. **前线波动函数有两份，必须同步**：`src/game/field.ts` 里的 `frontWave()`（JS）和 `FRONT_WAVE_GLSL`（着色器）。只改一边，士兵就会站不到战线上。
4. **单位动画在着色器里做**：几何体上有 `aPart` 属性（0 身体，1 左腿，2 右腿，3 手臂和枪，4 炮塔，5 炮管），实例属性 `aAnim = (phase, moving, fire, flash)`。给士兵或坦克加部件时要标对 `aPart`，详见渲染文档。
5. **要发光就给 HDR 颜色**：后期管线是 HalfFloat → Bloom → 移轴、暗角 → OutputPass（色调映射）。要让 Bloom 起作用，颜色必须超过阈值，可以用 `color.multiplyScalar(n)` 或调 shader 里的 intensity。不要靠调低阈值来解决，那样会让白天的白墙发光。
6. **`src/game/` 不准引入 `three` 和 DOM**，保持可测试。
7. **依赖要克制**：目前运行时依赖只有 `three` 和 `@fontsource-variable/inter`。字体必须本地打包，国内网络加载不了 Google Fonts。
8. **新增画面事件时也要配上声音**：在 `world.ts` 里调用 `this.audio?.xxx(...)`，经过 `ear()` 做空间化，并在 `AudioEngine` 的限流配置里给它一个上限。
   - 声音素材只能来自 `tools/audio/` 的生成管线，**不要手改 `src/audio/assets/`**（包括 `manifest.json`），改完要重新跑 `build_assets.py`。
   - 不要引入未授权的音频素材；`CREDITS.md` 里的版权声明必须保留。
9. 文档和提交说明用中文或英文都可以，与已有风格保持一致。提交信息末尾带 `Co-Authored-By`，按当前 agent 的约定写。

## 6. 完成标准（每次改动后）

1. `pnpm build`：tsc 和打包都通过。
2. `pnpm test`：全部通过。
3. 动了渲染或 HUD：`pnpm build && pnpm verify:screens`，然后**亲自看** `verification/*.png`。报告里的 FPS 和单位数要合理，并且没有「非预期」运行时错误。Binance 现在应该在线；脚本仍会过滤 451（Binance 对部分地区封锁时会出现）。
4. 动了数据层：`pnpm verify:feeds 60`，6 项检查全部 PASS。
4b. 动了音频：`pnpm build && pnpm verify:audio` 全部 PASS，并且听一下 `verification/audio-preview.wav`。
4c. 动了 HUD 或样式：`pnpm build && pnpm verify:mobile` 全部 PASS，并亲自看 `verification/mobile/` 里至少手机竖屏、横屏各一张。
5. 更新 [docs/handoff/session-log.md](docs/handoff/session-log.md)；有新的待办或已知问题，写进 [docs/roadmap/backlog.md](docs/roadmap/backlog.md)。

## 7. 环境陷阱（已踩过）

| 现象 | 原因 / 处理 |
| --- | --- |
| Binance `api/stream.binance.com` 返回 **451** | Binance 按其服务条款对部分地区封锁这两个主机，当前网络属于预期内。现货行情已改用 Binance 官方的公开行情专用主机 `data-stream.binance.vision`（不受此限制，消息格式相同），`fstream.binance.com` 的爆仓流本来就能连。如果以后 `.vision` 也 451，适配器会指数退避重连，指数自动排除它。 |
| Bybit REST 返回 **403** | 只是 REST 被拦，WS 正常，项目只用 WS。 |
| Bitstamp REST 没有 CORS 头 | 浏览器拿不到 24h 成交额，权重改用 10 分钟滚动成交额估算。 |
| Deribit `trades.option.ETH.raw` 报 `raw_subscriptions_not_available_for_unauthorized` | 改用 `trades.option.ETH.100ms`。 |
| `tsx` 卡死，esbuild 无法运行 | pnpm 11 需要在 `pnpm-workspace.yaml` 里设置 `allowBuilds: { esbuild: true }`，然后 `pnpm rebuild esbuild`。 |
| Node 抓取脚本跑完不退出 | 部分 WebSocket 关闭后会滞留，脚本末尾要显式 `process.exit()`。 |
| 截图里 FPS 偏低 | 用户自己的浏览器标签页同时在跑，共用 GPU，需要单独复测。 |
| 本机网络 | 访问 GitHub 和 npm 正常。 |

## 8. 用户偏好

- 用户用中文交流，回复用中文。
- **ETH War 和 Bitcoin Battle 是两个独立的目录，不要混着改。** 母项目在 `~/Documents/Bitcoin Battle`，有自己的 git 仓库、公开的 GitHub 远端和生产站点；在这里干活时不要动它，更不要用它的 `deploy/` 脚本发布 ETH War（会覆盖母项目的线上站点）。
- 通用的改进（画面、音频、HUD）如果两边都要，先在一边做完验证，再照搬到另一边，并在两边的 session-log 里各记一笔。
- 推送、部署都需要用户在当次会话里明确授权。**服务器和本机环境的细节只写进 `private/`，不要写进入库文件或提交信息**（本机网络配置也算）。仓库启用了 `scripts/git-hooks/`（新 clone 先 `git config core.hooksPath scripts/git-hooks`），敏感词清单在本机 `private/deploy/forbidden-patterns.txt`（从母项目复制，不入库）；提交统一用 UTC（`TZ=UTC git commit …`），推送前 `pnpm check:public` 必须通过；不要用 `--no-verify` 绕过。提交直接在 `main` 上，没有用 PR；不要 force push。
