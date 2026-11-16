#!/usr/bin/env node
// bcio: the BCIO cross-asset engine in your shell. Stock tokens (NVDA, TSLA, QQQ) and crypto
// (BTC, ETH, SOL, AI coins) read together: quotes, correlation and lag, the weekend shield check,
// a wallet on Robinhood Chain mainnet, and an MCP server for Claude. Read-only: no keys, no signing.
// Market data: CoinGecko public API. Chain: Robinhood Chain mainnet (4663), Chainlink prices.
const VERSION = "1.1.0";
const SITE = "https://github.com/bcioagents/bcio-agent";
const CG = "https://api.coingecko.com/api/v3";
const RPC = process.env.BCIO_RPC || "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const BCIO_API = process.env.BCIO_API || "https://bcio.trade";
// Robinhood Chain mainnet: [token, decimals, Chainlink USD feed]. Sources: api.robinhood.com/rhj/assets,
// docs.robinhood.com/chain, feeds verified on-chain by description().
const TOKENS = {
  USDG: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", 6, "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2"],
  NVDA: ["0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", 18, "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15"],
  TSLA: ["0x322F0929c4625eD5bAd873c95208D54E1c003b2d", 18, "0x4A1166a659A55625345e9515b32adECea5547C38"],
  QQQ: ["0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", 18, "0x80901d846d5D7B030F26B480776EE3b29374C2ae"],
  WETH: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", 18, "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9"],
};
const ASSETS = [
  { sym: "NVDA", name: "Nvidia", kind: "stock", cg: "nvidia-robinhood-tokenized-stock" },
  { sym: "TSLA", name: "Tesla", kind: "stock", cg: "tesla-robinhood-tokenized-stock" },
  { sym: "QQQ", name: "Invesco QQQ", kind: "stock", cg: "invesco-qqq-robinhood-tokenized-stock" },
  { sym: "BTC", name: "Bitcoin", kind: "crypto", cg: "bitcoin" },
  { sym: "ETH", name: "Ethereum", kind: "crypto", cg: "ethereum" },
  { sym: "SOL", name: "Solana", kind: "crypto", cg: "solana" },
  { sym: "RENDER", name: "Render", kind: "crypto", cg: "render-token" },
  { sym: "TAO", name: "Bittensor", kind: "crypto", cg: "bittensor" },
  { sym: "FET", name: "ASI Alliance", kind: "crypto", cg: "fetch-ai" },
];
const SYMS = ASSETS.map((a) => a.sym);
const asset = (s) => {
  const a = ASSETS.find((x) => x.sym === String(s || "").toUpperCase());
  if (!a) throw new Error(`Unknown symbol "${s}". Use one of: ${SYMS.join(", ")}`);
  return a;
};
const MCP_MODE = process.argv[2] === "mcp";

// ---------- output ----------
const tty = !MCP_MODE && (process.stdout.isTTY || (!!process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0")) && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const gold = c("38;2;226;184;100"), down = c("38;2;240;128;110"), up = c("38;2;140;214;150");
const dim = c("2"), bold = c("1");
const out = (s = "") => process.stdout.write(s + "\n");
process.stdout.on("error", (e) => { if (e.code === "EPIPE") process.exit(0); throw e; });
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
const pad = (s, n, right = false) => { const g = Math.max(0, n - strip(s).length); return right ? " ".repeat(g) + s : s + " ".repeat(g); };
const pct = (x, d = 2) => (x == null ? "–" : (x > 0 ? "+" : "") + Number(x).toFixed(d) + "%");
const tone = (x) => (x > 0 ? up : x < 0 ? down : (s) => s);
const money = (x) => (x == null ? "–" : "$" + Number(x).toLocaleString("en-US", { maximumFractionDigits: x >= 100 ? 2 : x >= 1 ? 3 : 5 }));
const spark = (pts, n = 24) => {
  if (!pts?.length) return "";
  const step = pts.length / n, s = Array.from({ length: n }, (_, i) => pts[Math.floor(i * step)]);
  const lo = Math.min(...s), hi = Math.max(...s), bars = "▁▂▃▄▅▆▇█";
  return s.map((p) => bars[Math.round(((p - lo) / (hi - lo || 1)) * 7)]).join("");
};
function head(title) { out(); out(`  ${gold("✺")} ${bold("BCIO")} ${dim("·")} ${title}`); out(dim("  " + "─".repeat(66))); }

// ---------- market data (CoinGecko, one request at a time) ----------
let lastCall = 0, chain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cg(path) {
  const job = chain.then(async () => {
    const gap = process.env.COINGECKO_API_KEY ? 300 : 2500;
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const headers = { accept: "application/json", "user-agent": "bcio-cli/" + VERSION };
    if (process.env.COINGECKO_API_KEY) headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
    let r;
    // the free API allows a few calls per minute: on 429 wait and try again (twice)
    for (let attempt = 0; ; attempt++) {
      try { r = await fetch(CG + path, { headers }); } catch { throw new Error("Cannot reach CoinGecko. Check your connection."); }
      if (r.status !== 429 || attempt === 2) break;
      const wait = (Number(r.headers.get("retry-after")) || 20 * (attempt + 1)) * 1000;
      if (!MCP_MODE) process.stderr.write(dim(`  CoinGecko is busy, retrying in ${Math.round(wait / 1000)} s…\n`));
      await sleep(wait);
    }
    lastCall = Date.now();
    if (r.status === 429) throw new Error("CoinGecko rate limit. Wait a minute, or set COINGECKO_API_KEY (free demo key).");
    if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
    return r.json();
  });
  chain = job.catch(() => {});
  return job;
}
const memo = new Map();
const once = (key, load) => { if (!memo.has(key)) memo.set(key, load().catch((e) => { memo.delete(key); throw e; })); return memo.get(key); };

function quotes() {
  return once("quotes", async () => {
    const rows = await cg(`/coins/markets?vs_currency=usd&ids=${ASSETS.map((a) => a.cg).join(",")}&sparkline=true&price_change_percentage=24h,7d`);
    const by = new Map(rows.map((r) => [r.id, r]));
    return ASSETS.map((a) => {
      const r = by.get(a.cg) || {};
      return { symbol: a.sym, name: a.name, kind: a.kind, price: r.current_price ?? null, change24h_pct: r.price_change_percentage_24h_in_currency ?? null, change7d_pct: r.price_change_percentage_7d_in_currency ?? null, spark7d: r.sparkline_in_7d?.price || [] };
    });
  });
}
const history = (sym, days) => once(`h:${sym}:${days}`, async () => (await cg(`/coins/${asset(sym).cg}/market_chart?vs_currency=usd&days=${days}`)).prices || []);

// ---------- analytics ----------
const logReturns = (p) => p.slice(1).map((b, i) => (p[i] > 0 && b > 0 ? Math.log(b / p[i]) : 0));
function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 8) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return sx && sy ? sxy / Math.sqrt(sx * sy) : null;
}
function alignHourly(a, b) {
  const bucket = (pts) => new Map(pts.map(([t, p]) => [Math.round(t / 3_600_000), p]));
  const ma = bucket(a), mb = bucket(b);
  const hours = [...ma.keys()].filter((h) => mb.has(h)).sort((x, y) => x - y);
  return { a: hours.map((h) => ma.get(h)), b: hours.map((h) => mb.get(h)) };
}
function lagScan(ra, rb, maxLag = 12) {
  const curve = [];
  for (let L = -maxLag; L <= maxLag; L++) {
    const x = [], y = [];
    for (let i = 0; i < ra.length; i++) { const j = i + L; if (j >= 0 && j < rb.length) { x.push(ra[i]); y.push(rb[j]); } }
    const v = pearson(x, y);
    if (v !== null) curve.push({ lag_h: L, corr: v });
  }
  return { best: curve.reduce((p, r) => (!p || r.corr > p.corr ? r : p), null), zero: curve.find((r) => r.lag_h === 0), curve };
}
function marketStatus(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  const mins = (Number(p.hour) % 24) * 60 + Number(p.minute), weekend = p.weekday === "Sat" || p.weekday === "Sun";
  let session = "closed";
  if (!weekend) session = mins >= 570 && mins < 960 ? "regular" : mins >= 240 && mins < 570 ? "pre-market" : mins >= 960 && mins < 1200 ? "after-hours" : "closed";
  return { ny_time: `${p.weekday} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} ET`, weekend, session, wall_street_open: session === "regular", stock_tokens: "trading 24/7 on-chain", note: "US exchange holidays are not counted." };
}

async function correlate(a, b, days = 7) {
  const A = asset(a), B = asset(b), d = Math.max(2, Math.min(30, Math.round(days)));
  const al = alignHourly(await history(A.sym, d), await history(B.sym, d));
  const s = lagScan(logReturns(al.a), logReturns(al.b));
  const r = (x) => (x == null ? null : Number(x.toFixed(3)));
  return {
    a: A.sym, b: B.sym, days: d, hours: al.a.length,
    corr_same_hour: r(s.zero?.corr), best_lag_h: s.best?.lag_h ?? null, corr_at_best_lag: r(s.best?.corr),
    lag_convention: `best_lag_h > 0 means ${B.sym} tends to move that many hours AFTER ${A.sym}; < 0 means ${B.sym} leads`,
    curve: s.curve.map((x) => ({ lag_h: x.lag_h, corr: r(x.corr) })),
    note: "Correlation of hourly log returns. It describes the past, not the future.",
  };
}
async function matrix(days = 7) {
  const series = {};
  for (const a of ASSETS) series[a.sym] = await history(a.sym, days);
  const m = SYMS.map((x) => SYMS.map((y) => {
    if (x === y) return 1;
    const al = alignHourly(series[x], series[y]);
    const v = pearson(logReturns(al.a), logReturns(al.b));
    return v == null ? null : Number(v.toFixed(2));
  }));
  return { days, symbols: SYMS, matrix: m, note: "Same-hour correlation of hourly log returns." };
}
async function shield(threshold = 5) {
  const q = await quotes(), ms = marketStatus();
  const crypto = q.filter((x) => ["BTC", "ETH", "SOL"].includes(x.symbol));
  const movers = crypto.filter((x) => Math.abs(x.change24h_pct || 0) >= threshold);
  const closed = !ms.wall_street_open;
  return {
    market: ms, threshold_pct: threshold, alert: closed && movers.length > 0,
    crypto_24h: crypto.map(({ symbol, price, change24h_pct }) => ({ symbol, price, change24h_pct })),
    movers: movers.map((x) => x.symbol),
    stock_tokens: q.filter((x) => x.kind === "stock").map(({ symbol, price, change24h_pct }) => ({ symbol, price, change24h_pct })),
    reading: closed
      ? movers.length ? `Wall Street is closed and ${movers.map((x) => `${x.symbol} ${pct(x.change24h_pct, 1)}`).join(", ")} moved past ${threshold}% in 24h. Stock tokens keep trading on-chain and can follow.` : `Wall Street is closed; crypto moved less than ${threshold}% in 24h. Quiet.`
      : "Wall Street is open: stock tokens track the live session.",
  };
}

// ---------- Robinhood Chain mainnet (raw JSON-RPC) ----------
const word = (addr) => addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
async function call(to, data) {
  let r;
  try { r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) }); }
  catch { throw new Error(`Cannot reach ${RPC}.`); }
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const big = (hex, i = 0) => BigInt("0x" + (hex.replace(/^0x/, "").slice(i * 64, i * 64 + 64) || "0"));
const units = (v, dec) => Number(v) / 10 ** dec;
async function wallet(addr) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr || "")) throw new Error("Give a wallet address: bcio wallet 0x…");
  const rows = await Promise.all(Object.entries(TOKENS).map(async ([sym, [tok, dec, feed]]) => {
    const [bal, round] = await Promise.all([call(tok, "0x70a08231" + word(addr)), call(feed, "0xfeaf968c")]);
    const amount = units(big(bal), dec), price = units(big(round, 1), 8);
    return { symbol: sym, amount, price, value_usd: amount * price };
  }));
  const total = rows.reduce((s, r) => s + r.value_usd, 0);
  rows.forEach((r) => { r.weight_pct = total ? (r.value_usd / total) * 100 : 0; });
  // BCIO agent contract + agent address come from the live site, so this never goes stale
  let cfg = {};
  try { cfg = await (await fetch(`${BCIO_API}/api/chain`)).json(); } catch { /* site unreachable: skip the permission */ }
  let agent_permission = { active: false, note: "BCIO agent contract not deployed yet" };
  if (cfg.agentContract && cfg.agent) {
    const pol = await call(cfg.agentContract, "0x187a7b8f" + word(addr) + word(cfg.agent));
    const expiry = Number(big(pol, 2)), now = Date.now() / 1000, today = Math.floor(now / 86400);
    agent_permission = expiry > now
      ? { active: true, contract: cfg.agentContract, agent: cfg.agent, max_trade_usd: units(big(pol, 0), 6), max_day_usd: units(big(pol, 1), 6), max_deviation_pct: Number(big(pol, 4)) / 100, spent_today_usd: Number(big(pol, 3)) === today ? units(big(pol, 5), 6) : 0, expires: new Date(expiry * 1000).toISOString() }
      : { active: false, contract: cfg.agentContract, agent: cfg.agent };
  }
  return {
    network: "Robinhood Chain mainnet (4663)", address: addr, total_usd: total, positions: rows, agent_permission,
    explorer: `${EXPLORER}/address/${addr}`,
    note: "Real tokens on Robinhood Chain, valued at Chainlink prices. Stock tokens are not shares.",
  };
}

// ---------- commands ----------
async function board() {
  const [q, ms] = [await quotes(), marketStatus()];
  head(`stocks + crypto · ${ms.ny_time} · Wall Street ${ms.wall_street_open ? up("open") : gold(ms.session)}`);
  out(dim(`  ${pad("", 8)}${pad("price", 13, true)}  ${pad("24h", 9, true)}  ${pad("7d", 9, true)}   7 days`));
  for (const a of q) {
    const tag = a.kind === "stock" ? gold("stock token") : dim("crypto");
    out(`  ${pad(bold(a.symbol), 8)}${pad(money(a.price), 13, true)}  ${pad(tone(a.change24h_pct)(pct(a.change24h_pct)), 9, true)}  ${pad(tone(a.change7d_pct)(pct(a.change7d_pct)), 9, true)}   ${tone(a.change7d_pct)(spark(a.spark7d))}  ${tag}`);
  }
  const s = await shield();
  out(); out(`  ${s.alert ? down("●") : up("●")} ${s.reading}`);
  out(dim("  bcio corr NVDA BTC · bcio matrix · bcio shield · bcio wallet 0x… · bcio mcp")); out();
}
async function corrCmd(a = "NVDA", b = "BTC", days = 7) {
  const r = await correlate(a, b, Number(days) || 7);
  head(`${r.a} vs ${r.b} · ${r.days} days · ${r.hours} hourly points`);
  out(`  same hour     ${bold(r.corr_same_hour?.toFixed(2) ?? "–")}`);
  const lagTxt = r.best_lag_h === 0 ? "they move in the same hour" : r.best_lag_h > 0 ? `${r.b} tends to follow ${r.a} by ${r.best_lag_h}h` : `${r.b} tends to lead ${r.a} by ${-r.best_lag_h}h`;
  out(`  best lag      ${bold(gold((r.best_lag_h > 0 ? "+" : "") + r.best_lag_h + "h"))}  corr ${bold(r.corr_at_best_lag?.toFixed(2) ?? "–")}  ${dim(lagTxt)}`);
  out();
  const max = Math.max(...r.curve.map((x) => Math.abs(x.corr)), 0.01), H = 6;
  for (let row = H; row >= 1; row--) {
    out("  " + r.curve.map((x) => (x.corr > 0 && (x.corr / max) * H >= row - 0.5 ? (x.lag_h === r.best_lag_h ? gold("█") : "▇") : " ")).join(""));
  }
  out(dim("  " + pad("-12h", 12) + pad("0", 1) + pad("+12h", 12, true)));
  out(); out(dim(`  ${r.note}`)); out();
}
async function matrixCmd(days = 7) {
  if (!process.env.COINGECKO_API_KEY) process.stderr.write(dim("  reading 9 histories from CoinGecko (about 25 s; COINGECKO_API_KEY makes it faster)…\n"));
  const r = await matrix(Number(days) || 7);
  head(`correlation · ${r.days} days · hourly returns`);
  out("  " + pad("", 8) + r.symbols.map((s) => pad(dim(s.slice(0, 4)), 6, true)).join(""));
  r.matrix.forEach((row, i) => out("  " + pad(bold(r.symbols[i]), 8) + row.map((v, j) => pad(i === j ? dim("·") : v == null ? "–" : (v >= 0.7 ? gold : v >= 0.4 ? (s) => s : dim)(v.toFixed(2)), 6, true)).join("")));
  out(); out(dim(`  ${r.note} Gold = 0.70 or higher.`)); out();
}
async function shieldCmd(t = 5) {
  const s = await shield(Number(t) || 5);
  head(`weekend shield · ${s.market.ny_time} · trigger ${s.threshold_pct}% in 24h`);
  for (const x of s.crypto_24h) out(`  ${pad(bold(x.symbol), 8)}${pad(money(x.price), 13, true)}  ${tone(x.change24h_pct)(pct(x.change24h_pct))}`);
  out(dim("  stock tokens"));
  for (const x of s.stock_tokens) out(`  ${pad(gold(x.symbol), 8)}${pad(money(x.price), 13, true)}  ${tone(x.change24h_pct)(pct(x.change24h_pct))}`);
  out(); out(`  ${s.alert ? down("● alert") : up("● calm")}  ${s.reading}`); out();
}
async function walletCmd(addr) {
  const w = await wallet(addr);
  head(`wallet on Robinhood Chain · ${addr.slice(0, 6)}…${addr.slice(-4)}`);
  for (const p of w.positions.filter((x) => x.amount > 0)) out(`  ${pad(bold(p.symbol), 8)}${pad(p.amount.toLocaleString("en-US", { maximumFractionDigits: 4 }), 16, true)}  ${pad(money(p.value_usd), 12, true)}  ${dim(p.weight_pct.toFixed(1) + "%")}`);
  if (!w.positions.some((x) => x.amount > 0)) out(dim("  no USDG, stock tokens or WETH on Robinhood Chain in this wallet"));
  out(`  ${pad(dim("total"), 8)}${pad("", 16)}  ${pad(bold(money(w.total_usd)), 12, true)}`);
  out();
  const a = w.agent_permission;
  out(a.active ? `  ${up("●")} agent allowed: ${money(a.max_trade_usd)} per trade, ${money(a.max_day_usd)} per day (spent ${money(a.spent_today_usd)}), until ${a.expires.slice(0, 10)}` : `  ${dim("○ agent has no permission on this wallet")}`);
  out(dim(`  ${w.explorer}`)); out();
}
function help() {
  out(); out(`  ${gold("✺")} ${bold("BCIO")} ${dim("v" + VERSION + " · stocks and crypto, read together")}`); out();
  out(`  ${bold("bcio")}                       NVDA, TSLA, QQQ, BTC, ETH, SOL, RENDER, TAO, FET + market status`);
  out(`  ${bold("bcio corr")} ${dim("<A> <B> [days]")}   correlation and lag of hourly returns (default NVDA BTC 7)`);
  out(`  ${bold("bcio matrix")} ${dim("[days]")}         correlation matrix of all nine`);
  out(`  ${bold("bcio shield")} ${dim("[pct]")}          weekend shield check: crypto moving while Wall Street is closed`);
  out(`  ${bold("bcio wallet")} ${dim("<0x…>")}          a wallet on Robinhood Chain + the agent's on-chain limits`);
  out(`  ${bold("bcio mcp")}                   MCP server (stdio) with these tools, for Claude and other clients`); out();
  out(dim("  Read-only: no keys, no signing. Data: CoinGecko public API (COINGECKO_API_KEY optional)."));
  out(dim(`  Chain: Robinhood Chain mainnet (BCIO_RPC to override). ${SITE}`)); out();
}

// ---------- MCP server (stdio, newline-delimited JSON-RPC 2.0) ----------
const TOOLS = [
  { name: "get_quotes", description: "Live price, 24h and 7d change for Robinhood stock tokens (NVDA, TSLA, QQQ) and crypto (BTC, ETH, SOL, RENDER, TAO, FET).", inputSchema: { type: "object", properties: {} }, run: async () => (await quotes()).map(({ spark7d, ...q }) => q) },
  { name: "market_status", description: "Whether the US stock market (NYSE/Nasdaq) is open now. Stock tokens keep trading 24/7 on-chain.", inputSchema: { type: "object", properties: {} }, run: async () => marketStatus() },
  { name: "correlate", description: "Correlation of hourly log returns between two assets, plus the lag (hours) at which they line up best. Use it to ask whether one asset leads another, e.g. does BTC follow NVDA.", inputSchema: { type: "object", properties: { a: { type: "string", enum: SYMS }, b: { type: "string", enum: SYMS }, days: { type: "number", minimum: 2, maximum: 30, default: 7 } }, required: ["a", "b"] }, run: async (x) => correlate(x.a, x.b, x.days ?? 7) },
  { name: "correlation_matrix", description: "Same-hour correlation matrix of hourly returns for all nine assets. Slow without COINGECKO_API_KEY (about 25 s).", inputSchema: { type: "object", properties: { days: { type: "number", minimum: 2, maximum: 30, default: 7 } } }, run: async (x) => matrix(x.days ?? 7) },
  { name: "weekend_shield", description: "Checks whether crypto (BTC, ETH, SOL) moved past a threshold in 24h while Wall Street is closed, and lists the stock tokens that can follow.", inputSchema: { type: "object", properties: { threshold_pct: { type: "number", minimum: 0.5, maximum: 50, default: 5 } } }, run: async (x) => shield(x.threshold_pct ?? 5) },
  { name: "get_wallet", description: "Positions of a wallet on Robinhood Chain mainnet (USDG, NVDA, TSLA, QQQ stock tokens, WETH) valued at Chainlink prices, plus the BCIO agent's on-chain trading limits for that wallet.", inputSchema: { type: "object", properties: { address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }, required: ["address"] }, run: async (x) => wallet(x.address) },
];
function mcp() {
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
  const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) handle(line);
    }
  });
  async function handle(line) {
    let m;
    try { m = JSON.parse(line); } catch { return fail(null, -32700, "Parse error"); }
    const { id, method, params = {} } = m;
    if (id === undefined) return; // notifications
    if (method === "initialize") {
      return reply(id, {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "bcio", version: VERSION },
        instructions: "BCIO reads Robinhood stock tokens and crypto together. Read-only market data (CoinGecko) and Robinhood Chain mainnet reads; it never signs or trades. Correlations describe the past, not the future.",
      });
    }
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    if (method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `Unknown tool ${params.name}`);
      try {
        const data = await tool.run(params.arguments || {});
        return reply(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
      } catch (e) {
        return reply(id, { isError: true, content: [{ type: "text", text: e.message }] });
      }
    }
    return fail(id, -32601, `Method not found: ${method}`);
  }
  process.stderr.write(`bcio MCP server v${VERSION} ready (stdio, ${TOOLS.length} tools)\n`);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (!cmd) await board();
  else if (cmd === "mcp") mcp();
  else if (["help", "-h", "--help"].includes(cmd)) help();
  else if (["-v", "--version"].includes(cmd)) out(VERSION);
  else if (cmd === "corr") await corrCmd(...args);
  else if (cmd === "matrix") await matrixCmd(...args);
  else if (cmd === "shield") await shieldCmd(...args);
  else if (cmd === "wallet") await walletCmd(args[0]);
  else { help(); process.exitCode = 1; }
} catch (e) { out(); out(`  ${down("✕")} ${e.message}`); out(); process.exitCode = 1; }
