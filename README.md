# ETH War

中文名「以太坊战争」。Bitcoin Battle 的 ETH 版：把实时 ETH 行情做成 3D 牛熊战场。玩法来自 Newhedge「Bitcoin Battlefield」（<https://newhedge.io/bitcoin/battlefield>）。ETH 价格就是战线，盘口挂单就是兵力，主动成交、爆仓和期权成交会变成战场上的炮击。

- **许可**：[PolyForm Noncommercial 1.0.0](LICENSE.md)。可以复制、分发、修改，**不可以商用**，详见文末「[许可](#许可)」
- 可行性结论和验证证据：[docs/research/feasibility.md](docs/research/feasibility.md)
- **接手开发（人或 agent）请先读 [AGENTS.md](AGENTS.md)**，全部文档索引在 [docs/README.md](docs/README.md)

## 运行

```bash
pnpm install
pnpm dev                 # http://localhost:5173 实时行情
                         # http://localhost:5173/?sim 离线模拟行情
pnpm test                # 单元测试（解析器使用真实抓取的交易所消息）
pnpm verify:feeds [秒]   # 在 Node 里跑真实交易所连接，输出指数/盘口/事件检查（默认 45 秒）
pnpm build && pnpm verify:screens   # 无头 Chrome 截图 + FPS/报错收集，输出到 verification/
pnpm capture:fixtures [秒]  # 抓取真实交易所消息到 tests/fixtures/_capture/，用来刷新测试夹具
pnpm build && pnpm verify:audio  # 音频检查，并渲染试听文件 verification/audio-preview.wav
pnpm build && pnpm verify:mobile # 手机/平板/窄窗口布局检查：遮挡、出界、文字溢出，截图在 verification/mobile/
```

### URL 参数

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `sim` | 使用离线模拟行情 | 关 |
| `seed`, `speed` | 模拟行情的随机种子和速度 | 7, 1 |
| `range` | 一回合的半宽（%），价格打到 ±range 即胜 | 0.25 |
| `big` | 大单阈值（USD，按同一主动单合并后计算）。不填或 `auto` 时随市场自适应：上限 $10K，清淡时最低降到 $2K，让市场动态每分钟约有 10 笔；`big=5000` 这样写则固定 | auto |
| `sources` | 逗号分隔的数据源，如 `coinbase,kraken,okx` | 全部 |
| `light` | `auto` / `golden` / `day` / `night` | auto（按本地时间） |
| `lang` | `zh` / `en` 界面语言（也可点右上角按钮或按 L 切换，选择会记住） | 跟随浏览器 |
| `post` | `0` 关闭后期处理（泛光、移轴、暗角） | 开 |
| `q` | `low` 关闭阴影和后期处理，并使用 1x 像素比（适合低配设备） | high |
| `sound` | `0` 关闭声音（不记住选择；按钮和 M 键的选择会记住） | 开（浏览器允许时自动播放，否则点击画面任意位置后出声） |

### 操作

拖动旋转，滚轮缩放，W/A/S/D 平移，Q/E 环绕，C 切换电影镜头，F 回到前线，L 切换中英文，M 开关声音。

### 画面效果

- 后期：泛光（Bloom）、移轴微缩模糊（电影镜头下更强）、暗角、按光照预设调色、4x MSAA。
- 单位：行军摆腿、开枪后坐、坦克炮管后坐和行驶扬尘，受击闪光后倒地再爬起。
- 交火：前线士兵按主动成交流量对射（曳光弹、枪口火光）；大单、爆仓是炮击，带碎块、焦痕、冲击波、镜头震动。
- 环境：树木随风摆动、云影掠过地面、前线硝烟、战线流光脉冲，价格变动时战线闪多空颜色。
- 回合：攻陷后败方旗帜降下、换成胜方颜色再升起，基地上空连环爆炸。
- 声音（默认开启）：管弦配乐随行情切换，平静时是 M2「暗涌」，激战时是 M1「铁血进行曲」，胜利时是 M3「破晓冲锋」；多层合成的步枪和机枪（牛熊音色不同）、坦克炮、四档爆炸、爆仓炮弹呼啸、信号弹、开战号角、胜利号曲，都按画面位置做立体声，远处更闷。详见 [docs/audio/README.md](docs/audio/README.md)，致谢见 [CREDITS.md](CREDITS.md)。

## 结构

```
src/data/feeds/exchanges.ts  各交易所解析器（纯函数）+ 连接配置
src/data/feeds/wsFeed.ts     WebSocket：指数退避重连、心跳、看门狗
src/data/orderbook.ts        L2 订单簿（快照/增量、按深度截断、去交叉）
src/data/market.ts           MarketHub：USDT→USD、成交量加权指数、离群剔除、
                             主动单合并（大单）、爆仓/期权事件、深度分桶、流量
src/data/sim.ts              离线模拟行情（同一套事件接口）
src/game/battle.ts           回合/胜负、战况播报
src/game/field.ts            价格 → 战场坐标、前线波动函数（与着色器共用）
src/game/armies.ts           深度 → 前线士兵 / 方阵 / 坦克 / 基地储备
src/render/*                 Three.js：地形与领土着色器、实例化兵力、特效、
                             基地、光照预设、镜头导演
src/render/post.ts           后期处理（泛光、移轴、暗角、调色）
src/ui/*                     HUD（价格、战况条、深度图、流水、交易所状态）、中英文字典 i18n.ts
```

### 映射规则

- **战线** = 聚合价格。价格低于战线的一侧（买盘）是牛方领土，高于战线的一侧（卖盘）是熊方领土。
- **回合**：开局时以当前价为中心，在 ±0.25% 处各设一个基地。价格打到熊方基地即牛方获胜，反之熊方获胜；6 秒后以新价格开下一局。
- **兵力**：总深度在场上约折合 1100 名士兵，1 名士兵对应的金额取 1/2/2.5/5 的整数档；1 辆坦克等于 25 名士兵的金额，由单桶挂单墙生成。
  - 前线 3 个分桶内的挂单组成贴着战线的士兵排。
  - 场内挂单按其价格位置排成方阵。
  - 基地以外、±1% 以内的挂单算作储备。
- **事件**：
  - 主动大单：己方坦克或士兵开炮。
  - 爆仓：从后方打来的重炮。空头爆仓时炮弹落在熊方阵地，多头爆仓时落在牛方阵地。
  - 期权大单：信号弹。
  - 金额很大的事件会让电影镜头切过去特写。

## 访问统计

线上页面会加载 Cloudflare Web Analytics 的 beacon（`src/analytics.ts`），用来统计访问量。它不使用 Cookie，不采集个人信息；只在 `ethwar.ondream.ai` 域名下加载，本地开发、预览和验证脚本不会上报，加载失败也不影响页面。

## 许可

本仓库作者自己的作品（代码、文档、音频、图片）以 [PolyForm Noncommercial License 1.0.0](LICENSE.md) 发布：

- **可以**：复制、分发、修改，用于非商业目的，例如个人学习、研究、爱好项目，以及慈善组织、教育机构、公共研究机构、政府机构的使用。分发时必须附上许可条款（或其网址），以及 `LICENSE.md` 顶部的 `Required Notice` 版权声明。
- **不可以**：商业用途。需要商业授权请通过 GitHub 联系仓库所有者。
- 第三方组件（three.js、Inter 字体、MuseScore_General 音色库等）按各自的许可证，见 [CREDITS.md](CREDITS.md)。「Bitcoin Battlefield」和 Newhedge 的名称、标识归其所有者，Ethereum 标识归其所有者，本许可不授予任何第三方权利。

以上只是摘要，以 [LICENSE.md](LICENSE.md) 英文原文为准。
