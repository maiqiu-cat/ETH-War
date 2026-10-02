# 各交易所细节与坑

格式依据：2026-10-01 抓到的真实消息（`tests/fixtures/`）。没抓到真实消息的部分，按官方文档实现，会标注「未实盘核对」。

## Coinbase

- **成交**：用 Exchange feed 的 `matches` 频道。
  - `side` 是**挂单方（maker）**的方向，所以主动方要取反：`side: "sell"` 表示主动买入。
  - `last_match` 是订阅时回放的上一笔，要忽略。
  - 时间戳用 `Date.parse(m.time)`。
- **行情**：同一条连接上的 `ticker` 频道，取 `open_24h` 和 `volume_24h`（单位是 ETH）；`quoteVolume24h = volume_24h × price`。
- **盘口**：用 Advanced Trade 的 `level2` 频道（公开，不需要鉴权）。
  - 消息格式是 `{channel: "l2_data", events: [{type: "snapshot" | "update", updates: [{side: "bid" | "offer", price_level, new_quantity}]}]}`。
  - 快照是**全量盘口**，买卖各几千档，所以 MarketHub 每 5s 剪掉离中价超过 5% 的档位。
  - 必须同时订阅 `heartbeats`，否则没有更新时连接会被关闭。
- Exchange feed 的 `level2_batch` 频道现在需要鉴权，所以盘口走 Advanced Trade。

## Kraken（WS v2）

- **数字**：v2 返回的是 JSON 数字，不是字符串。
- **盘口**：订阅 `depth: 500`。
  - 官方要求客户端在每次更新后**把盘口截断到订阅深度**，否则会残留过期档位。`OrderBook.truncate(500)` 负责这一步。
  - 消息里带 `checksum`（CRC32），目前**没有校验**，留作生产化事项。
- **成交**：`side` 就是主动方。
- **行情**：同时订阅 `ETH/USD` 和 `USDT/USD`。
  - `USDT/USD` 的 `last` 就是全局 USDT 汇率。只接受 0.9 到 1.1 之间的值。
  - `ETH/USD`：`open24h = last − change`，`quoteVolume24h = volume × vwap`。

## OKX

- **心跳**：每 20s 发一次纯字符串 `ping`，服务端回纯字符串 `pong`。`WsFeed` 只对以 `{` 或 `[` 开头的消息做 JSON 解析，所以这里没问题。
- **成交**：`trades` 频道，`side` 就是主动方，`ts` 是毫秒字符串。
- **盘口**：`books` 频道，400 档。`action: "snapshot" | "update"`，每档格式是 `[px, sz, "0", 订单数]`。消息里有 `checksum`，目前没有校验。
- **行情**：`tickers` 频道。`volCcy24h` 是**计价货币（USDT）**的成交额，`vol24h` 是 ETH 数量。
- **爆仓**：订阅 `liquidation-orders`（`instType: SWAP`），会推送**全市场所有币种**的爆仓，按 `instId` 过滤：
  - `ETH-USDT-SWAP`：U 本位，每张合约 0.1 ETH，`usd = sz × 0.1 × bkPx`
  - `ETH-USD-SWAP`：币本位，每张合约 10 USD，`usd = sz × 10`
  - **哪一方被爆**：`posSide` 是 `long` 或 `short` 时直接用；`net` 模式下 `side: "sell"`（强平卖出）表示多头被爆。
  - 已实盘确认：能收到其他币种（PUMP）的爆仓，并被正确过滤掉。ETH 爆仓还没有在实盘中观察到。

## Bybit（v5）

- **REST 返回 403**，但 WS 正常，项目只用 WS。
- **心跳**：每 20s 发 `{"op": "ping"}`。
- **现货**：
  - `publicTrade.ETHUSDT`：`S: "Buy" | "Sell"` 是主动方。
  - `orderbook.200.ETHUSDT`：`type: "snapshot" | "delta"`，数量为 `"0"` 表示删除该档。
  - `tickers.ETHUSDT`：`turnover24h`（USDT 成交额）、`prevPrice24h`。
- **爆仓**：`allLiquidation.ETHUSDT` 在 **linear 端点**上（现货端点没有这个频道）。
  - 字段 `S` 按官方文档是**持仓方向**：`Buy` 表示多头被爆。
  - ⚠️ **未实盘核对**：抓取窗口里没有发生爆仓。看到第一条实盘爆仓时，要和价格方向对照确认这个语义，见 backlog。

## Bitstamp

- **成交**：`live_trades_ethusd` 频道，`type: 0` 是主动买、`1` 是主动卖。时间用 `microtimestamp / 1000`。
- **盘口**：`order_book_ethusd` 频道，**每条消息都是 top100 快照**，所以 `snapshot: true`。增量频道 `diff_order_book` 需要先拉 REST 快照，但 REST 不带 CORS 头，所以没有用。
- **没有 24h 成交额**：权重改用 10 分钟滚动成交额推算（见指数方法）。刚启动时权重偏低，这是已知问题。

## Binance

- **主机**：现货用 `wss://data-stream.binance.vision`，这是 Binance 官方文档列出的「仅公开行情」主机（REST 对应 `data-api.binance.vision`），路径和消息格式与 `stream.binance.com` 完全一样。
  - 2026-10-03 实测（当前网络）：`api.binance.com` 和 `stream.binance.com`（9443/443）都返回 451「Service unavailable from a restricted location according to 'b. Eligibility'」，是 Binance 对部分地区的封锁；`data-stream.binance.vision` 和 `fstream.binance.com` 握手 101，`stream.binance.us` 也通（但 Binance.US 成交量小，没有用）。
  - 如果 `.vision` 也被封，适配器一直退避重连，最长间隔 60s，不影响其他交易所。
- 合并流的消息格式是 `{stream, data}`。
  - `aggTrade`：`m: true` 表示买方是挂单方，也就是**主动卖出**。
  - `depth20@100ms`：每 100ms 推一次前 20 档快照。
  - `24hrTicker`：`q` 是计价货币成交额，`o` 是开盘价。
  - `forceOrder`（fstream）：`o.S` 是**强平单的方向**，`SELL` 表示多头被爆。成交价优先取 `ap`（均价）。
- 验证：`pnpm verify:feeds 60` 应看到 Binance 进入指数且偏差在 30bp 以内。

## Deribit

- **频道**：`trades.option.ETH.raw` 需要鉴权，所以用 `trades.option.ETH.100ms`。
- **心跳**：连上后先发 `public/set_heartbeat {interval: 30}`。服务端会发来 `{method: "heartbeat", params: {type: "test_request"}}`，要回一条 `public/test`，由 `WsFeedOptions.reply` 负责。
- **成交**：
  - `price` 是期权价格（**单位 ETH**），`amount` 是合约数（1 张 = 1 ETH），`index_price` 是标的指数价，`direction` 是主动方。
  - 权利金 `premiumUsd = price × amount × index_price`。
  - 在 MarketHub 里，权利金 ≥ $1,000 才会进市场流水（`bigOptionPremiumUsd`）。
- 实盘观察：90 秒内收到 11 笔期权成交，其中一笔权利金 $160K。

## 通用坑

- **USD 和 USDT 的价差**：实测 USDT 计价的交易所比 USD 计价的高约 0.07%。必须先乘以 USDT/USD 汇率（实测约 0.9994）再聚合，否则指数会被拉高。
- **盘口交叉**：增量更新丢包，或者截断不及时，都可能导致买一 ≥ 卖一。`OrderBook.uncross()` 会删除没更新的那一侧的交叉档位，`verify:feeds` 也会检查有没有交叉。
- **一笔主动单会拆成多条成交**：吃掉多档时会产生多条 print。MarketHub 把同一交易所、同方向、间隔 ≤100ms 的成交合并成一笔，再判断是不是大单。
