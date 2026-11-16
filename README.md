<p align="center"><img src="https://raw.githubusercontent.com/bcioagents/bcio-agent/main/brand/logo.png" width="140" alt="BCIO"></p>

<h1 align="center">bcio-agent</h1>

<p align="center"><b>Stocks and crypto, read together.</b> BCIO in your terminal and in Claude.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/bcio-agent"><img src="https://img.shields.io/npm/v/bcio-agent?color=c98a1e&label=npm" alt="npm"></a>
  <a href="https://github.com/bcioagents/bcio-agent"><img src="https://img.shields.io/badge/github-bcio--agent-23260f?logo=github" alt="GitHub"></a>
  <a href="#mcp-server"><img src="https://img.shields.io/badge/MCP-server-e2c58e" alt="MCP server"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b8b96" alt="MIT"></a>
</p>

BCIO is a cross-asset AI terminal on Robinhood Chain. It reads Robinhood **stock tokens** (NVDA, TSLA, QQQ) and **crypto** (BTC, ETH, SOL and the AI coins RENDER, TAO, FET) as one market. Stock tokens trade 24/7 on-chain, so when Wall Street closes for the weekend and crypto moves, BCIO can see which stock tokens are exposed.

This package only **reads**. It holds no keys and signs nothing. Trading, baskets and the weekend shield run in the BCIO web terminal, where your own wallet signs.

## Use

```sh
npx bcio-agent                    # nine assets, 24 h and 7 d move, Wall Street status, shield check
npx bcio-agent corr NVDA BTC      # correlation of hourly returns and the lag between them
npx bcio-agent matrix             # 9 × 9 correlation matrix
npx bcio-agent shield             # crypto moving while Wall Street is closed?
npx bcio-agent wallet 0x…         # a wallet on Robinhood Chain + the BCIO agent's on-chain limits
npx bcio-agent --help
```

Or install once and run `bcio`:

```sh
npm i -g bcio-agent
bcio corr TSLA SOL 14
```

## MCP server

`bcio mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio, so Claude (or any MCP client) can use the BCIO engine directly.

**Claude Code**

```sh
claude mcp add bcio -- npx -y bcio-agent mcp
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "bcio": { "command": "npx", "args": ["-y", "bcio-agent", "mcp"] }
  }
}
```

Then ask things like *"Does BTC follow NVDA? Find the lag."* or *"Wall Street is closed. Which stock tokens are exposed to the crypto move?"*

| Tool | What it returns |
|---|---|
| `get_quotes` | Price, 24 h and 7 d change for all nine assets |
| `market_status` | Whether NYSE/Nasdaq is open now (New York time) |
| `correlate` | Same-hour correlation of hourly log returns, and the lag (−12 h to +12 h) where two assets line up best |
| `correlation_matrix` | Correlation matrix of all nine assets |
| `weekend_shield` | Crypto moves past a threshold while Wall Street is closed, plus the stock tokens that can follow |
| `get_wallet` | Positions on Robinhood Chain mainnet (USDG, NVDA, TSLA, QQQ, WETH) at Chainlink prices, and the BCIO agent's trading limits for that wallet |

## How it reads

1. **Prices.** CoinGecko public API. Robinhood stock tokens are listed there as tokenized stocks, so their prices keep moving on weekends. Requests are spaced out and retried when the free API is busy; set `COINGECKO_API_KEY` (a free demo key) for faster calls.
2. **Correlation.** Hourly prices are aligned by the hour and turned into log returns. Pearson correlation at lag 0, then a scan from −12 h to +12 h. A positive best lag means the second asset tends to move after the first.
3. **Market hours.** NYSE regular session 09:30–16:00 New York time, plus pre-market and after-hours.
4. **Wallet.** Plain JSON-RPC reads on Robinhood Chain mainnet (chain id 4663): token balances, Chainlink USD prices, and the agent policy (tokens, max per trade, max per day, max price gap, expiry) the user set in the BCIO agent contract. The contract address is read from bcio.trade/api/chain.

| Setting | Default |
|---|---|
| `COINGECKO_API_KEY` | none (free public API) |
| `BCIO_RPC` | `https://rpc.mainnet.chain.robinhood.com` |
| `BCIO_API` | `https://bcio.trade` |
| `NO_COLOR` | colors on in a terminal |

Explorer: [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)

## Honest limits

Correlations describe the past, not the future. US exchange holidays are not counted. Stock tokens are not shares. The wallet view covers USDG, NVDA, TSLA, QQQ and WETH on Robinhood Chain. Robinhood stock tokens are not offered to US persons and are restricted in some other countries. Data, not financial advice. Not affiliated with Robinhood, CoinGecko or any listed company.

## License

MIT
