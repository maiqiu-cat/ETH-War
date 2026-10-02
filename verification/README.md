# verification/

验证脚本的输出目录。怎么跑、标准是什么，见 [docs/verification/README.md](../docs/verification/README.md)。

| 文件 | 来源 | 入库 |
| --- | --- | --- |
| `feeds-report.json` | `pnpm verify:feeds`：每家交易所的统计、指数、流动性、流量、事件、断言、盘口交叉记录 | 是（保留最近一次） |
| `screens-report.json` | `pnpm verify:screens`：每个运行的 WebGL 渲染器、每张截图的统计（FPS、单位数、指数、回合、横幅、语言）、报错 | 是（保留最近一次） |
| `*.png` | `pnpm verify:screens` 的截图 | 否（`.gitignore`） |
| `mobile-report.json` | `pnpm verify:mobile`：每个视口和语言的 HUD 块坐标、重叠、出界、溢出、最小字号、失败原因 | 是（保留最近一次） |
| `mobile/*.jpg` | `pnpm verify:mobile` 的截图（每个视口 × 语言一张，另有一张带开场横幅） | 否（`.gitignore`） |

长期保留的效果图放在 `docs/screens/`（JPG）。
