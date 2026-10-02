# 数据源总表

全部是**公开、无需鉴权**的 WebSocket，浏览器直连。逐家细节见 [exchanges.md](exchanges.md)，指数怎么算见 [index-methodology.md](index-methodology.md)。

| 交易所 | 用途 | 连接（`feedOptions()` 里的 channel） | 计价 | 盘口深度 | 心跳 | 本机网络（2026-10-02） | 解析器 / 夹具 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Coinbase | 现货成交 + 24h 行情 | `trades`：`ws-feed.exchange.coinbase.com`（matches、ticker） | USD | — | — | ✅ | `parseCoinbase` / `coinbase.json` |
| Coinbase | 现货盘口 | `book`：`advanced-trade-ws.coinbase.com`（level2、heartbeats） | USD | 全量，每 5s 剪掉 ±5% 以外的档位 | 订阅 heartbeats | ✅ | `parseCoinbaseL2` / `coinbase-adv.json` |
| Kraken | 盘口、成交、行情、**USDT/USD 汇率** | `spot`：`ws.kraken.com/v2` | USD | 500 | 服务端 heartbeat | ✅ | `parseKraken` / `kraken.json` |
| OKX | 现货盘口、成交、行情 + **全市场永续爆仓** | `spot+liq`：`ws.okx.com:8443/ws/v5/public` | USDT | 400 | 每 20s 发字符串 `ping` | ✅ | `parseOkx` / `okx.json` |
| Bybit | 现货盘口、成交、行情 | `spot`：`stream.bybit.com/v5/public/spot` | USDT | 200 | 每 20s 发 `{"op":"ping"}` | ✅（REST 403，WS 正常） | `parseBybitSpot` / `bybit-spot.json` |
| Bybit | U 本位永续爆仓 | `liq`：`stream.bybit.com/v5/public/linear` | USDT | — | 同上 | ✅（还没抓到实盘爆仓） | `parseBybitLiq` / 无（用合成消息测试） |
| Bitstamp | 盘口（每次推 top100 快照）、成交 | `spot`：`ws.bitstamp.net` | USD | 100 | — | ✅（REST 不带 CORS 头） | `parseBitstamp` / `bitstamp.json` |
| Binance | 现货 aggTrade、depth20、24h 行情 | `spot`：`data-stream.binance.vision`（公开行情专用主机；`stream.binance.com` 对部分地区返回 451） | USDT | 20（每次快照） | — | ✅（2026-10-03 起） | `parseBinance` / `binance.json` |
| Binance | ETHUSDT 永续爆仓 | `liq`：`fstream.binance.com` | USDT | — | — | ✅ 能连上（爆仓本身稀少） | 同上（forceOrder 用合成消息） |
| Deribit | ETH 期权成交 | `options`：`www.deribit.com/ws/api/v2`，频道 `trades.option.ETH.100ms` | USD（权利金按 ETH 报价，换算成 USD） | — | `public/set_heartbeat` 30s，收到 `test_request` 回 `public/test` | ✅ | `parseDeribit` / `deribit.json` + 合成消息 |

**连通性的分工**：

- **进入指数的现货**：Coinbase、Kraken、OKX、Bybit、Bitstamp，以及 Binance。
- **爆仓**：OKX、Bybit、Binance。
- **期权**：Deribit。
- **USDT/USD 汇率**：只来自 Kraken 的 `USDT/USD` ticker。拿不到时按 1.0 计算，`hub.usdtUsdKnown` 为 false。

## 新增一家交易所的步骤

1. 在 `scripts/capture-fixtures.mjs` 里加一项，运行 `pnpm capture:fixtures 60`，拿到真实消息样本。
2. 在 `src/data/feeds/exchanges.ts` 里写纯函数 `parseXxx(msg): ParsedEvents | null`：
   - 搞清楚 `side` 的语义，必须是**主动方**。
   - 计价货币标成 `USD` 或 `USDT`。
   - 盘口要设 `snapshot` 和 `depth`。
3. 在 `feedOptions()` 里加连接配置（url、订阅消息、ping、reply、staleMs），并把交易所加进 `ExchangeId` 和 `ALL_SOURCES`。
4. 把样本放进 `tests/fixtures/`，在 `tests/parsers.test.ts` 里加用例，至少覆盖：成交的方向、盘口快照和增量、ticker 成交额、订阅确认被忽略。
5. 在 `src/ui/hud.ts` 的 `EX_LABEL` 和 `EX_COLOR` 里加上名称和颜色。
6. 运行 `pnpm verify:feeds 60`，确认新交易所进入指数、偏差小于 30bp、盘口没有交叉。
7. 更新本表和 [exchanges.md](exchanges.md)。
