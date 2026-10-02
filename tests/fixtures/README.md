# 测试夹具：真实交易所消息

2026-10-02 从公开 WebSocket 抓取，供 `tests/parsers.test.ts` 使用。

- **格式**：`{ "<消息类别>": [最多 3 条样本] }`。消息里超过 12 项的数组会被截断，例如盘口快照。
- **类别名**：由抓取脚本里的 `kindOf()` 生成，例如 `books:snapshot`、`type:match`、`live_trades_ethusd:`。

| 文件 | 连接 | 备注 |
| --- | --- | --- |
| `okx.json` | OKX public | 有成交、盘口、ticker、爆仓（窗口内只有非 ETH 币种的爆仓，用来测试过滤） |
| `coinbase.json` | Coinbase Exchange matches + ticker | — |
| `coinbase-adv.json` | Coinbase Advanced Trade level2 + heartbeats | — |
| `kraken.json` | Kraken v2 book + trade + ticker（ETH/USD、USDT/USD） | — |
| `bitstamp.json` | Bitstamp 成交 + order_book | 测试用了 `live_trades_ethusd:` 的第 [1] 条（第 [0] 条是订阅确认） |
| `bybit-spot.json` | Bybit spot | — |
| `bybit-linear.json` | Bybit linear allLiquidation | 只有订阅确认（窗口内没有爆仓），测试改用合成消息 |
| `binance.json` | Binance 合并流（`data-stream.binance.vision`，aggTrade、depth20、ticker） | 2026-10-03 抓取；forceOrder 仍用合成消息 |
| `deribit.json` | Deribit | `trades.option.ETH.100ms` 的真实期权成交（`.raw` 频道需要鉴权，不能用） |

## 刷新

```bash
pnpm capture:fixtures 90       # 输出到 tests/fixtures/_capture/（不入库）
diff <(jq -S . tests/fixtures/okx.json) <(jq -S . tests/fixtures/_capture/okx.json) | head
```

1. 确认测试用到的类别名在新文件里还存在。
2. 再把新文件复制过来，跑 `pnpm test`。

如果交易所改了格式，**先改解析器、再换夹具**，并在 [docs/data-sources/exchanges.md](../../docs/data-sources/exchanges.md) 里记一笔。
