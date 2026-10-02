# 指数与事件的计算方法

实现在 `src/data/market.ts → MarketHub`，参数在 `DEFAULT_MARKET_CONFIG`。`main.ts` 默认开启 `adaptiveBig`（上限 10,000、下限 2,000、目标 10 笔/分钟，见 [mapping-rules.md](../game-design/mapping-rules.md)），URL 参数 `big=N` 改为固定阈值。

## 聚合价格（战线位置）

```
对每家现货交易所 v（最近一笔成交在 staleTradeMs=120s 以内）：
  priceUsd_v = last_v × fx(quote_v)            fx(USDT) = Kraken USDT/USD，取不到时为 1
  weight_v   = quoteVol24h_v × fx              有 24h 行情的交易所
             = notionalPerMin_v × 1440         没有的（Bitstamp、Binance）：10 分钟滚动成交额折算成日成交额
median = 所有 priceUsd 的中位数
included_v = |priceUsd_v / median − 1| ≤ outlierPct(0.5%)
index = Σ(priceUsd × weight) / Σ weight        只算 included 的；weight ≤ 0 时按 1 计
open24h = 用同样的权重对各家 open24h×fx 加权平均  → HUD 上的 24 小时涨跌
```

- 用**最新成交价**，不用盘口中间价。原因：原版的说法是 volume-weighted real-time price，而且 5 家以上交易所平均后，买卖价之间的来回跳动可以忽略。
- 滚动成交额：`notionalPerMin = 10 分钟内成交额 / min(10, max(0.5, 距首笔成交的分钟数))`，内部用累加和维护。
- 实测（90 秒）：各家偏离指数在 ±1.2bp 以内。权重大约是 OKX 33%、Coinbase 28%、Bybit 26%、Kraken 11%、Bitstamp 1–2%。Bitstamp 偏低是因为它冷启动用的是滚动估算。

## 深度与流动性

- `depth(bucket, min, max, source)`：
  - 把所有**新鲜**盘口（`staleBookMs` = 30s 内更新过）换算成 USD 价格，按 `floor(priceUsd / bucket)` 分桶，累加 USD 金额。
  - `source` 可以是 `'all'` 或某一家交易所。
- `liquidity(pct)`：指数 ±pct 以内的买、卖盘 USD 总额。HUD 上显示的是 ±1%。
- 盘口剪枝：`tick()` 每 5s 剪掉每家离中价超过 5% 的档位，防止 Coinbase 的全量盘口越积越大。

## 主动流量

- 按秒分桶，最多保留 600 桶，`flow(ms)` 返回窗口内的 `{buy, sell}` USD 金额。
- 用途：
  - 前线对射频率：最近 5 秒
  - 战线波动幅度：`amp = 1.4 + 买卖失衡度 × 2.6`
  - 战况播报：最近 20 秒

## 事件（市场流水和战场炮击）

| 类型 `FeedItem.type` | 来源 | 触发条件 | `bull` |
| --- | --- | --- | --- |
| `bigBuy` / `bigSell` | 现货成交，合并同一主动单（同交易所、同方向、相邻成交间隔 ≤100ms，超过 150ms 没有新成交就结算） | 合并后 ≥ 当前阈值 `hub.bigTradeUsd`（页面上自适应 $2K–$10K，类默认固定 $50K） | 主动买为 true |
| `optBuy` / `optSell` | Deribit 期权 | 权利金 ≥ $1,000 | 主动买为 true |
| `liqShort` / `liqLong` | OKX、Bybit、Binance 的爆仓 | ≥ $2,000（`minLiquidationUsd`） | 空头被爆为 true（推动价格上涨） |

- 每个事件都带自增 `id`。`hub.feed` 保留最近 60 条。
- 事件里的 `label` 是英文，只供脚本和日志使用。**界面一律用 `type` 去取 i18n 文案**。

## 已实现波动率（市场状态）

`realizedVolPct(5)`：取最近 5 分钟、每分钟一个点的对数收益率，算标准差（%）。需要至少 1 分钟的历史，不够时返回 NaN，HUD 显示「数据预热中」。阈值在 `main.ts → regimeKey()`：低于 0.03 为平静，低于 0.08 为活跃，以上为剧烈波动。
