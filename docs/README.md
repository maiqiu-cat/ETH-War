# 文档索引

所有开发资料都在这里。入口是根目录的 [AGENTS.md](../AGENTS.md)。

| 目录 | 内容 | 什么时候读 |
| --- | --- | --- |
| [handoff/](handoff/) | [session-log.md](handoff/session-log.md)：历次会话做了什么、提交、验证数据<br>[runbook.md](handoff/runbook.md)：环境、运行、git 和 GitHub、排障<br>[deploy.md](handoff/deploy.md)：发布到 ethwar.ondream.ai 的机制、安全设计和步骤<br>[release-and-publish.md](handoff/release-and-publish.md)：Codex 操作手册，生产发布和 GitHub 公开仓库推送<br>服务器参数和每次发布的手册只在本机 `private/docs/handoff/`（不入库） | 接手第一件事 |
| [roadmap/](roadmap/) | [backlog.md](roadmap/backlog.md)：按优先级排的待办、已知问题、待用户决定的问题 | 决定下一步做什么 |
| [architecture/](architecture/) | [overview.md](architecture/overview.md)：分层、数据流、运行循环、坐标系<br>[modules.md](architecture/modules.md)：逐文件职责和关键导出 | 改任何代码之前 |
| [data-sources/](data-sources/) | [README.md](data-sources/README.md)：交易所总表<br>[exchanges.md](data-sources/exchanges.md)：逐家频道、格式、方向语义、坑<br>[index-methodology.md](data-sources/index-methodology.md)：指数、权重、大单合并 | 改数据层 |
| [game-design/](game-design/) | [mapping-rules.md](game-design/mapping-rules.md)：行情 → 战场的全部映射规则和可调参数 | 改玩法或参数 |
| [rendering/](rendering/) | [visual-system.md](rendering/visual-system.md)：场景、着色器、实例化、特效、后期、镜头、性能 | 改画面 |
| [ui/](ui/) | [hud-and-i18n.md](ui/hud-and-i18n.md)：HUD 结构、动效、多语言做法 | 改界面或文案 |
| [audio/](audio/) | [README.md](audio/README.md)：配乐和音效的设计、信号链、触发点、调音位置、验证方法 | 改声音 |
| [verification/](verification/) | [README.md](verification/README.md)：测试清单、验证脚本、最新结果、人工验收清单 | 每次改完 |
| [decisions/](decisions/) | 架构决策记录（ADR），说明为什么这样做、什么时候该重新评估 | 想推翻现有设计之前 |
| [research/](research/) | [feasibility.md](research/feasibility.md)：可行性评估<br>[newhedge-reference.md](research/newhedge-reference.md)：原版逐帧拆解<br>原视频参考帧在母项目 Bitcoin Battle 的本机 `private/` 里（第三方画面，不入库） | 对照原版做效果 |
| [screens/](screens/) | 本项目各版本的效果截图 | 看现状 |

其他就近放置的说明：

- [`tests/fixtures/README.md`](../tests/fixtures/README.md)：测试夹具从哪来、怎么刷新
- [`verification/README.md`](../verification/README.md)：验证报告文件的含义
