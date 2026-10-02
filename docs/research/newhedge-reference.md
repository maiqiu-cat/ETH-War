# 原版参考：Newhedge「Bitcoin Battlefield」

> 本文沿用自母项目 Bitcoin Battle（`~/Documents/Bitcoin Battle`），描述的是原版「Bitcoin Battlefield」和当时针对 BTC 的调研。ETH War 用同一套方案，只把标的换成 ETH。

- 推文：<https://x.com/newhedge_io/status/2104903265959760161>（2026-09-29，@newhedge_io）
- 产品页：<https://newhedge.io/bitcoin/battlefield>（被 Cloudflare 人机验证拦截，无法抓取页面源码）
- 推文原文：

  > Bitcoin Battlefield just got a major upgrade! Newhedge's real-time Bitcoin price, volume-weighted across exchanges, alongside live order books, large trade monitor and liquidations. Upgraded visuals. Smarter battlefield action. Cinematic cameras. Watch bulls and bears fight for control of Bitcoin's price.

- 视频：20.5 秒，1920×1080。取得方式：
  1. 用 `https://api.fxtwitter.com/newhedge_io/status/2104903265959760161` 拿到推文信息和视频地址。
  2. 下载 720p mp4，用 `ffmpeg -vf fps=0.5` 每 2 秒抽一帧，存在本机 `private/research/newhedge-frames/`（第三方画面，不入库）。

## 逐帧

| 帧 | 画面 | 要点 |
| --- | --- | --- |
| `frame-00s` | 高空斜俯视沙盘，中央「BATTLE BEGINS」 | 横幅：牛头、熊头图标，「BULLS $84,433.48 to win / BEARS $83,950.52 to win」，副标题「Armies deploying to the front」，中间是带刻度点的进度线 |
| `frame-02s` | 同上，镜头推近 | 储备标签开局为「$0 · No reserves」，之后积累；副标题换成「Price moves the front. Capture the enemy base to win.」 |
| `frame-04s` | 低空沿战线看 | 战线两侧是密集的士兵带，绿色坦克和红色坦克各沿己方一侧排开；公路横穿战线 |
| `frame-06s` | 正俯视 | 战线基本笔直；士兵带厚约 3–5 个身位，**坦克排在士兵带的紧后方**；场地边缘有价格刻度（84,150 / 84,200 / 84,250…，间距 $50） |
| `frame-08s` | 低空近景 | 爆炸有闪光和烟；战线是绿白色的发光线 |
| `frame-10s` | 斜俯视 | 「BID RESERVES ≈$1.4M · 27 troops · 1 tank」，「ASK RESERVES ≈$777.4K · 14 troops · 1 tank」；播报「Ask resistance reinforced」 |
| `frame-12s` | 斜俯视 | 「BID RESERVES ≈$3.7M · 67 troops · 4 tanks」 |
| `frame-14s` | 斜俯视 | 储备数字继续增长（≈$5.8M · 107 troops · 5 tanks），说明储备是**逐步累积**的，不是一次性显示 |
| `frame-16s` | 低空，战线弯曲 | 战线呈 S 形，前线有炮火和烟；地上有前线价格标签「$84,222.56」 |
| `frame-18s` | 低空 | **悬停提示**「Ask resistance · $84,266.00 · Resting sell wall …」；市场流水里出现带 Binance 图标的「Large buy trade $59.6K」 |

## UI 清单（原版）

- **左上**：「Quiet market」带一条滑杆、「Off」下拉框（作用不明，可能是声音或自动模式）、「Golden hour」光照下拉框，以及一行「14:35 · Golden hour · Clear」（时间、光照、**天气**）。
- **上中**：「BTC/USD · AGGREGATED SPOT」、大号价格、24h 涨跌；战况条写着「← BEARS WIN $x」、播报、「BULLS WIN $y →」，中间是进度。
- **左右两侧**：BID / ASK LIQUIDITY 金额。
- **右上**：5 个图标按钮，大致是全屏、电影镜头、切换、聚焦、飞行模式。
- **左下**：ORDER BOOK DEPTH，「Aggregated spot depth」，SOURCE 下拉框，累计深度图标出 BID WALL / ASK WALL，下方是价格轴；按键提示做成小按钮的样子：W A S D、PAN、SCROLL、ZOOM。
- **右下**：MARKET FEED（LIVE），包括 Large option buy/sell、Large buy trade，金额最小到 $517 级别（期权门槛很低），每条有交易所图标；底部有「Market chat · 10 messages · 24h」。

## 和本项目的差距

| 项 | 原版 | 本项目 | 差距或待办 |
| --- | --- | --- | --- |
| 美术 | 带动画的低多边形模型，地形起伏更大（远景有弧度） | 程序化方块小人，着色器摆腿 | backlog P2「美术资源」 |
| 战线形状 | 有机的 S 形，看起来和局部深度有关 | 三个正弦波叠加 | backlog P2，ADR 0004 |
| 坦克位置 | 紧贴前线、排成一列 | 按挂单墙所在的价格位置分散在场内 | 可以加一个「前线坦克排」：把近端的挂单墙排到士兵带后面 |
| 储备 | 开局为 $0，逐步积累 | 立即显示越过胜利线的全部深度 | 设计不同，按需调整 |
| 悬停提示 | 悬停在挂单墙或单位上显示价格和金额 | 没有 | backlog P2「点击单位显示挂单信息」 |
| 天气 | 有「Clear」字段 | 只有 3 种光照 | backlog P2「天气系统」 |
| 横幅 | 牛熊图标，副标题会换 | 菱形装饰加两侧细线，副标题显示胜利价格 | 可以加图标 |
| 期权门槛 | 约 $500 级别 | 权利金 $1,000 | 参数 `bigOptionPremiumUsd` |
| 聊天 | 有 | 没有 | backlog Q4 |
| 价格指数 | 自有的聚合指数 | 6 家交易所按成交额加权 | 口径接近，见 ADR 0003 |
