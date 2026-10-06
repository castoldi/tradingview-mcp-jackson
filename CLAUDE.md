# TradingView MCP — Claude Instructions

68 tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Environment (this machine)

| Setting | Value |
|---------|-------|
| OS | Windows 11 Home 10.0.26200 |
| User | `casto` |
| Project path | `C:\Data\ai_projects\tradingview-mcp-jackson` (moved from `C:\users\casto\...` on 2026-10-05) |
| Shell | PowerShell (pwsh) — default for all Bash/shell tool calls |
| Node | Available at system PATH |

### Running commands
- In Claude Code chat: prefix with `!` — e.g. `! node src/server.js`
- PowerShell syntax applies: use `$env:LOCALAPPDATA` not `$LOCALAPPDATA`, backtick `` ` `` for line continuation, `Copy-Item` not `cp`
- Bash tool is also available but PowerShell is preferred on this machine

### MCP Server status
The MCP server **is registered** at `C:\Users\casto\.claude\.mcp.json`. After restarting Claude Code, all 68 tools will be available — but only while TradingView is running with CDP enabled.

### Launch TradingView on this machine (Windows)
TradingView is installed as a Windows Store (MSIX) app. When the user says "launch tv" or asks to launch TradingView, run this PowerShell (the bat file is blocked by App Control):
```powershell
$tvExe = (Get-AppxPackage -Name "TradingView*").InstallLocation + "\TradingView.exe"
Start-Process $tvExe -ArgumentList "--remote-debugging-port=9222"
```

## Git workflow — ALWAYS commit and push (added 2026-10-03)

Every change to this repo (code, Pine scripts, `CLAUDE.md`, config) is committed and pushed in the same turn it's made. Don't ask first, and don't leave changes uncommitted at the end of a turn.

1. Add a line to `CHANGELOG.md` under today's `## YYYY-MM-DD` heading (create it if missing), in **Added / Changed / Fixed / Removed**. Say what changed and why, and name the files.
2. `git add` the specific files you changed, plus `CHANGELOG.md`. Never commit `.env`, `journal/` or other gitignored files.
3. Commit with a short imperative subject (e.g. `Add trading journal`).
4. `git push` to the current branch's upstream (`origin`, currently `trading-bot-3`). If the push fails, report the error. Never force-push, and never push to `upstream` (LewisWJackson's repo).

Journal entries (`scripts/journal.js`) are data, not code changes. They stay local and don't need a commit.

## Decision Tree — Which Tool When

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)

### "Work on Pine Script"
1. Open Pine Editor first: `ui_open_panel pine-editor open` (required before `pine_new`)
2. `pine_new` → create blank indicator/strategy/library (uses shared "Untitled" slot in editor)
3. `pine_set_source` → inject code into editor (always use `//@version=6`, not v5)
4. `pine_save_as name="..."` → **save as NEW cloud slot with the given name (does NOT overwrite existing saved scripts).** Use this for any new strategy. Only works on unsaved scripts — call right after `pine_new`+`pine_set_source`.
5. `pine_smart_compile` → compile with auto-detection + error check (also "Add to chart")
6. `pine_get_errors` → read compilation errors
7. `pine_get_console` → read log.info() output
8. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
9. `pine_save` → save updates to the CURRENTLY OPEN saved script (Ctrl+S, no rename). **Will overwrite the active cloud slot** — use only when editing an already-saved script that you intend to update in place.
10. `pine_open` → load a saved script by name

**Adding a NEW strategy without clobbering existing ones (correct flow as of 2026-05-23):**
```
ui_open_panel pine-editor open
pine_new type=indicator
pine_set_source source="..."
pine_save_as name="My Strategy"   ← critical: creates new cloud slot
pine_smart_compile                 ← adds to chart
```
The old broken flow (`pine_new` → `pine_smart_compile` directly) saves to the same "Untitled" slot every time and overwrites the previous strategy. Always go through `pine_save_as` for new strategies.

**"Add to chart" button workaround** — `ui_click text "Add to chart"` does NOT work. Use this instead:
```js
// via ui_evaluate:
const buttons = Array.from(document.querySelectorAll('button'));
const btn = buttons.find(b => b.textContent.trim().startsWith('Add to chart'));
if (btn) btn.click();
```

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` → see what's drawn
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage alerts"
- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

### "Adding indicators via `chart_manage_indicator`"
- `chart_manage_indicator action: add` is **unreliable on this machine** — it silently fails for EMA and other studies.
- Workaround: Write a Pine Script indicator that plots the needed values (`display=display.data_window`), add it via the "Add to chart" `ui_evaluate` workaround above, then read values with `data_get_study_values`.
- **Basic plan limit: 2 indicators max.** Adding a 3rd triggers the upgrade popup. Remove an existing indicator first with `chart_manage_indicator action: remove` using its entity_id from `chart_get_state`.

### "Upgrade popup appeared"
Dismiss it immediately with:
```js
// ui_keyboard key: "Escape"
```
This closes the popup without navigating away. Do this before attempting any other action.

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → take a screenshot (regions: "full", "chart", "strategy_tester")

### "TradingView isn't running" / "launch TradingView" / "start in debug mode"
- **Do NOT use `tv_launch`** — it cannot find the MSIX app on this machine.
- The bat script (`scripts\launch_tv_debug.bat`) is blocked by App Control. Use PowerShell instead, and kill any running instance first: if TradingView is already open without the debug flag, a second launch just focuses that window and CDP never comes up.
  ```powershell
  Stop-Process -Name TradingView -Force -ErrorAction SilentlyContinue; Start-Sleep 3
  $tvExe = (Get-AppxPackage -Name "TradingView*").InstallLocation + "\TradingView.exe"
  Start-Process $tvExe -ArgumentList "--remote-debugging-port=9222"
  ```
- CDP is ready when `http://localhost:9222/json/version` responds (can take 1–2 min).
- MCP server path in `C:\Users\casto\.claude\.mcp.json` must be `C:/Data/ai_projects/tradingview-mcp-jackson/src/server.js`. After changing it, run `/mcp` to reconnect. If the MCP tools are down but CDP is up, the `src/core/*.js` functions can be imported directly from a node script.
- `tv_health_check` → verify connection after launch

### Autonomous trading — NEVER ask for confirmation
The trading bot runs fully autonomously. When the cron fires:
- **Never pause to ask the user** before placing, modifying, or closing a trade
- **Never ask for confirmation** on position size, SL, TP, or order type
- Execute immediately and notify via email — the user is not monitoring the session
- If something is ambiguous, make the conservative choice (skip the trade) and log it

### "Start trading bot" / "start the bot" — full startup sequence
Run these steps in order every time:
1. Launch TradingView via the bat script (PowerShell tool, run in background)
2. `tv_health_check` → confirm CDP connected
3. `layout_switch name: "AUGUSTO"` → load the trading layout
4. `chart_set_symbol symbol: "OANDA:SPX500USD"` → ensure SPX500 is active
5. `chart_set_timeframe` → confirm 3m (only set if different)
5a. **Indicator-state check (added 2026-05-23 PM — REQUIRED until ORB-15 is back)**:
    - `chart_get_state` → list current studies
    - If `SPX500 ORB 15` is missing from `studies`, restore it before doing anything else:
        1. `ui_open_panel pine-editor open`
        2. `pine_new type: "indicator"`
        3. `pine_set_source` with the contents of `scripts/orb_15.pine`
        4. `pine_save_as name: "SPX500 ORB 15"` — must succeed (uses pine-facade API after the 2026-05-23 patch). If it fails, STOP and surface the error to the user — do NOT proceed with `pine_smart_compile`, which would clobber another slot.
        5. `pine_smart_compile` → confirms compile + adds to chart
        6. `ui_open_panel pine-editor close`
        7. `chart_get_state` → verify ORB-15 is now in `studies`
    - Same routine applies if `SPX500 Fib Scalper 1m` is missing (use `scripts/fib_scalper.pine`, slot name `SPX500 Fib Scalper 1m`). Basic-plan limit is 2 indicators per chart — ORB-15 + Fib Scalper is the intended pair on the 3m AUGUSTO layout; ATM Strategy and Tape Reader need their own chart or you have to swap.
    - Same routine applies if `SPX500 Tape Reader` is missing (use `scripts/tape_reader.pine`, slot name `SPX500 Tape Reader`). Tape Reader is the 4th strategy — does NOT live on the AUGUSTO 3m chart by default. Activate only when user swaps in Tape Reader for one of the active indicators (typically swap with ATM Strategy on a dedicated chart).
    - Background context: see [[pine-save-as-tool]] memory entry. The original `pine_save_as` had a bug that wiped both ORB-15 and EMA Bounce slots on 2026-05-23 PM. After ORB-15 is restored and you've verified the patched tool works, you can delete this step.
6. Create cron jobs (local CT time, Mon–Fri):
   - **ORB-15**: `CronCreate cron: "*/3 8-10 * * 1-5"` (8:30-8:44 forms range, signals fire 8:45-10:30 CT, one trade/day max)
   - **ATM Strategy**: `CronCreate cron: "*/3 8-13 * * 1-5"` (second HH/HL breakout, 8:45-14:00 CT excluding 12:00-12:44 lunch, one trade/day max)
   - **Fib Scalper 1m**: `CronCreate cron: "* 8-14 * * 1-5"` (every minute, 8:00-14:59 CT; indicator self-gates 8:30-14:30; requires 1m chart for full signal cadence)
   - **Tape Reader**: `CronCreate cron: "*/3 8-13 * * 1-5"` (every 3 min, 8:00-13:59 CT; indicator self-gates 8:45-14:00, one trade/day max). **Only create this cron if the Tape Reader indicator is actually loaded on a chart** — by default it is NOT on the AUGUSTO 3m chart. Skip otherwise.
   - **Market Close**: `CronCreate cron: "30 14 * * 1-5"` (close all SPX500 positions at 2:30 PM CT)
   - **Noon Summary**: `CronCreate cron: "3 12 * * 1-5"` (email mid-day summary at 12:03 CT — during lunch-skip trade window so no competition)
   - **EOD Summary**: `CronCreate cron: "35 14 * * 1-5"` (email EOD summary at 14:35 CT — 5 min after market close, when no trade crons compete) — MANDATORY, must always fire
   - EMA Bounce Scalper retired 2026-05-21 (0/4 WR).
   - EMA200 Touch indicator accidentally overwritten 2026-05-21 PM during ORB pine_new flow; cron deleted. Restore via Pine UI Save-As if needed.

**Critical timing notes for summary crons** (added 2026-05-21 after 3 PM EOD didn't fire):
- Session-only crons queue while Claude is busy with other tools. If multiple crons land on the same minute, some may not fire by the time the user notices.
- Schedule summaries at off-peak times: 12:03 CT (deep lunch, no trade-execution cron) and 14:35 CT (5 min after market close, no other crons).
- The `durable: true` flag is silently ignored on this version — crons are always session-only. They must be re-created every time the bot starts.
- If the EOD email is somehow missed, send it manually with `node scripts/send-summary-email.js "subject" "body"` as soon as you notice.
   - User is in **St. Louis, CT — CDT (UTC-5) in summer, CST (UTC-6) in winter**
   - Cron uses local time so DST is handled automatically — the expression never needs to change between seasons
7. Report the new cron job IDs (ORB-15, ATM, Fib Scalper, Tape Reader [if loaded], Market Close, Noon, EOD) and confirm all systems are live

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Trade Placement and Notifications

Each cron tick that produces a signal must run TWO scripts in order:

### 1. Place the trade — `scripts/place-trade.js`
- Connects to TradingView via CDP (localhost:9222) and drives the paper-trading order panel
- Usage: `node scripts/place-trade.js <BUY|SELL> <units> <sl> <tp> [symbol]`
- Selects side, switches to Market order type, enables SL/TP checkboxes, fills qty/sl/tp, clicks `place-and-modify-button`
- Soft-fails (exit 0) on any error so the loop keeps running
- **Requirement:** the order panel (`[data-name="order-panel"]`) must be visible on screen. The Trade button toggles it. The AUGUSTO layout should have it open.

### 2. Email notification — `scripts/notify-trade.js`
- Credentials stored in `.env` (gitignored): `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NOTIFY_EMAIL`
- Gmail App Password name: "tv_trading_bot"
- Usage: `node scripts/notify-trade.js <BUY|SELL> <price> <units> <sl> <tp> [symbol]`
- Soft-fails (no crash) if credentials missing or SMTP error

**Always run place-trade.js BEFORE notify-trade.js.** Email without a real order is misleading.

### 3. Journal it — `scripts/journal.js`
After notify-trade.js, run `node scripts/journal.js open ...` (see below). Every cron trade tick, skip and close also goes in the journal.

## Trading Journal (added 2026-10-03)

`scripts/journal.js` keeps the record of everything that happens when we trade: trades, the reasoning behind them, advice I give, market events, and lessons. Data is append-only in `journal/entries.jsonl`, with a readable day view regenerated at `journal/days/YYYY-MM-DD.md`. `journal/` is gitignored because it holds personal P&L. Times are shown in CT.

**Log as it happens, in the same turn, without asking.** Don't batch entries for later.

| When | Command |
|------|---------|
| Any trade placed (bot or user) | `node scripts/journal.js open <BUY\|SELL> <symbol> <entry> <units> <sl> <tp> --strategy "<name>" --source bot\|user "<why: signal values, levels, trend context>"` → prints the trade ID (`T-YYYYMMDD-n`) |
| Trade closed (TP, SL, manual, 14:30 close) | `node scripts/journal.js close <tradeId> <exit> "<why it closed>"` → computes pts, R, $ P&L. Run `open-trades` to find IDs. |
| Cron signal skipped (SL distance, time gate, etc.) | `node scripts/journal.js skip "<strategy>: <reason, with numbers>" --symbol <sym> --source bot` |
| I answer "good time to long/short?" | `node scripts/journal.js advice <symbol> <LONG\|SHORT\|WAIT\|NO> "<trigger, invalidation, target, R:R, key reasons>" --entry P --sl P --tp P` |
| Later we see how the advice played out | `node scripts/journal.js outcome <adviceId> <right\|wrong\|mixed\|untested> "<what happened>"` |
| Top-down analysis done | `node scripts/journal.js analysis "<bias + key levels per TF>" --symbol <sym>` |
| News, data releases, halts, tool/bot failures | `node scripts/journal.js event "<what>" [--tags macro,bot]` |
| User decides something (sizing, skipping a setup, rule change) | `node scripts/journal.js decision "<what and why>" --source user` |
| A takeaway worth keeping | `node scripts/journal.js lesson "<lesson>"` |

- `node scripts/journal.js show [date]` prints the day view; `stats [--since YYYY-MM-DD] [--strategy S]` gives win rate, pts, P&L, avg R, profit factor by strategy, and the advice hit rate.
- $ P&L is computed only for symbols with a known point value (`SYMBOL_MULT` in the script: `OANDA:SPX500USD` = $1/pt/unit). For futures such as NNQ, pass `--mult <$ per point per contract>` on `open`, after verifying it from the CME specs.
- **Before giving advice or starting the bot**, run `stats --since <7 days ago>` and skim recent lessons, so past mistakes inform the next call.
- **Noon/EOD summary emails** should be built from `journal.js show` output (trades, P&L, skips, events) instead of from memory.
- **At the start of a session**, follow up on advice still pending (`stats` → `advice.pending`) by logging an `outcome` once the result is known.

### Getting the user's real trades (added 2026-10-05)
The user also trades NNQ by hand in a **LIVE broker account `2039497`** (small, ~$66) that is connected in TradingView. There is also a SIM account, `DEMO8197451`. This is separate from the SPX500 paper-trading bot. When the user says "I took the trade", "I'm out" or "what did I make", don't ask for fills. Read them from TradingView:
1. `node scripts/broker-fills.js`. It reads the Account Manager's Account summary (Total P/L = **net realized P&L after fees**), the Orders tab (filled and cancelled orders, avg fill prices) and the Notifications log (every order placed, modified or executed, with timestamps). Trailing-stop moves appear there as "Stop Loss order modified". The script is read-only and returns the panel to Positions.
2. Work out entry, exit, stop moves, slippage (stop price vs. fill) and fees (`fees = gross − broker net`, where gross = pts × $0.20 × qty for NNQ).
3. Log it locally: `journal.js open ... --source user` and then `journal.js close <id> <exit> "<why, stop moves, slippage, fees>"`. If the trade followed advice, also log an `outcome` for that advice, plus a `lesson` when there is one.
4. Add it to the **NNQ Trade Book** web page: https://claude.ai/artifact/MJtxbQg9nhRpMQWPBf6Ezk (private, live). Its data lives in the artifact's db, so write with `ArtifactData` (`batch` of `set`s, and pass `if_version` when updating an existing doc). Don't republish the page to add data. Collections and fields:
   - `trades/<T-id>`: `id, date, entry_time, exit_time, symbol, contract, account_type (LIVE|SIM), side, qty, entry, exit, sl_initial, tp, high` (best price reached while in the trade), `stop_moves [{price,time}]` (the first entry is the initial SL), `pts, mult, gross, fees, net` (net = the broker's figure), `strategy, setup, exit_reason, lesson`
   - `notes/<L-or-E-id>`: `id, date, time, kind (Lesson|Event), text`
   Use the same IDs as `journal.js`. **The Trade Book holds only trades the user actually executed, plus lessons.** Planned entries, advice and setups that never triggered never go on the page. They stay in the local journal (`journal.js advice`/`outcome`) and on the chart.

### Entry plans go on the chart (added 2026-10-05)
Whenever I give an entry plan ("buy now?", "is there a short?"), draw it on the TradingView chart in the same turn. Don't wait to be asked.
- Use a `long_position` / `short_position` tool for each option (entry, SL, TP). `stopLevel`/`profitLevel` are in **ticks**: NNQ tick = **0.5**, so ticks = pts / 0.5. Use a `rectangle` for an entry zone and a dashed `horizontal_line` for a close-above/below trigger. Give each one a label naming the option and its condition.
- **Replace stale plans:** remove drawings for setups that are invalidated or superseded, so the chart only shows current options. Keep structural levels (ATH, trendlines). Drawing IDs are case-sensitive; read them from `listDrawings()` instead of retyping them. Drawings created through the API do not survive a TradingView restart (position tools especially).
- Take one `capture_screenshot` to confirm the drawings sit at the right prices.

**NNQ costs:** $0.20/pt, tick 0.5 = $0.10. A round trip costs about **$1.88 per contract** (measured 2026-10-05), which is **~9.4 pts to break even**. Stops are stop-market orders and slip a few pts overnight. Remind the user of this when they trail a stop to "just above entry".

## NNQ day-trading focus (added 2026-10-02)

The user is interested in **day-trading opportunities in NNQ** (`CME_MINI:NNQ1!`, E-nano Nasdaq-100 Futures, continuous contract). When they ask about "NQ", "NNQ", "the Nasdaq" or "is it a good time to buy/short", analyze NNQ1! with a day-trading lens. This is discretionary analysis on request — there is no NNQ cron or automated execution; the SPX500 bot below is separate.

**Analysis workflow** (top-down, intraday bias):
1. `chart_get_state` → note the current symbol/timeframe so you can restore it afterwards.
2. `chart_set_symbol CME_MINI:NNQ1!` → `quote_get`.
3. For each timeframe D → 60 → 15 → 5: `data_get_ohlcv summary: true`, plus EMA20/EMA50 (EMA200 on daily) and RSI14 — compute from bars if the indicators aren't on the chart (Basic plan: 2 indicators max).
4. Identify key intraday levels: prior-day high/low/close, overnight (Globex) high/low, today's high/low, the 8:30–8:44 CT opening range, and the most recent 15m swing high/low.
5. Restore the user's original symbol and timeframe.

**How to answer "good time to long/short?"**
- Lead with a direct verdict (yes / no / wait for X).
- Trade with the higher-timeframe trend by default; counter-trend calls need a concrete trigger (rejection at a level, or a 15m close through a swing level plus a failed retest). Overbought/oversold RSI alone is not a trigger.
- Give a specific entry trigger, invalidation (stop) level, and first target, and state the R:R. Avoid entries in the middle of the range.
- Flag time-of-day context: open chop 8:30–8:45 CT, lunch lull ~11:30–12:45 CT, and high-impact news (CPI, FOMC, NFP, mega-cap earnings — NQ is driven by AAPL/MSFT/NVDA/AMZN/META/GOOGL).
- Day trades only: no holding overnight; flat by the 15:00 CT cash close (equity-index futures halt 16:00–17:00 CT).
- **Target-reachability check (MANDATORY before quoting any target):** a target is only valid if price can realistically get there in the time left before the close. Before giving TPs:
  1. Pull 15m bars (`count: 500` ≈ 5 sessions) and, for the last 3–5 sessions, measure the range and the largest move in the trade's direction from the current time-of-day to 15:00 CT.
  2. Compare today's 8:30→now volume against the same window on prior days, and note how much of today's typical session range has already been used.
  3. If distance-to-target exceeds the typical remaining move, mark that target unrealistic and drop it. Don't present a measured move as a target just because the pattern projects it.
  4. **Fridays and the afternoon:** volume thins and price tends to chop after lunch, especially Friday afternoon as traders square up. On Friday NNQ also stops trading at 16:00 CT and doesn't reopen until 17:00 CT Sunday, so anything left open carries weekend gap risk. Favor the nearer target and plan to be flat by 15:00 CT.
  - Example (2026-10-02, Fri 12:00 CT): bear-flag TP2 was ~318 pts away, while the prior 3 afternoons (12:45–15:00 CT) ranged only 151–179 pts and today's whole session had already moved 294 pts. TP2 was unrealistic, so only TP1 (~100 pts) was valid.
- Verify the contract point value / tick value (`symbol_info` returns only metadata, so check the CME contract specs) before quoting dollar risk — don't assume it.

## Active Trading Setup (this account)

| Setting | Value |
|---------|-------|
| Layout | AUGUSTO |
| Broker | Paper Trading |
| Account | accastoldi USD (~$99,929 balance) |
| Active symbol | OANDA:SPX500USD, 3m |
| Indicators | "SPX500 Fib Scalper 1m" (added 2026-05-23). "SPX500 ORB 15" was wiped from chart + cloud on 2026-05-23 by the pine_new clobber bug — restore from `scripts/orb_15.pine` after restarting the MCP server (fixed `pine_save_as` now uses the pine-facade API). The Fib Scalper code currently lives inside the `SPX500 EMA Bounce Scalper` cloud slot (title is correct, slot folder name is wrong — cosmetic only). |
| Trading hours | 8:00 AM - 2:30 PM CT (close all positions by 2:30 PM CT mandatory) |
| Active cron loops | ORB-15 + ATM Strategy + Fib Scalper + market close + summaries |

### SPX500 EMA Bounce Scalper — strategy rules (CURRENT ACTIVE STRATEGY)
**Status**: ✓ LIVE (replaced EMA Crossover & RSI Momentum Reversal on 2026-05-20)

- **Indicator**: "SPX500 EMA Bounce Scalper" (Pine Script, custom)
- **Asset**: OANDA:SPX500USD, 3m
- **Core Logic**: Scalp EMA21 bounces with tight ATR-based stops
  - **BUY signal**: (price crosses above EMA21) OR (EMA21 touched in last 3 bars AND close > EMA21 AND close > prev close) — must have EMA8 ≥ EMA21 (short-term up momentum)
  - **SELL signal**: (price crosses below EMA21) OR (EMA21 touched in last 3 bars AND close < EMA21 AND close < prev close) — must have EMA8 ≤ EMA21 (short-term down momentum)
  - **Updated 2026-05-21**: Replaced EMA200 trend filter with EMA8 short-term momentum filter, added bounce detection alongside crossovers. Goal: 4-8× more signals per day.
- **Stop Loss**: `EMA21 ± 1.5×ATR` — provides 6–8 pt cushion on normal volatility days
  - Long SL: `EMA21 - 1.5×ATR` (computed in cron, NOT read from indicator's SL_long)
  - Short SL: `EMA21 + 1.5×ATR` (computed in cron, NOT read from indicator's SL_short)
- **Take Profit**: `entry ± 2.0×ATR` — R:R ~ 1.3 (fixed 2026-05-21; indicator's old TP fields had R:R 0.5 which was negative EV)
  - Long TP: `entry + 2.0×ATR` (computed in cron)
  - Short TP: `entry - 2.0×ATR` (computed in cron)
- **Cron computes SL/TP** from indicator's EMA21 + ATR rather than using the indicator's old SL/TP fields, which still report 0.75×ATR TP (legacy)
- **Signal output**: 1 = BUY, −1 = SELL, 0 = no signal (readable via `data_get_study_values`)
- **Position size**: `min(round(100 / |entry − SL|), 5000)` units — risk-adjusted to $100 per trade
- **Max risk per trade**: $100 (strict — never exceed)
- **Max units per trade**: 5,000 (hard cap regardless of formula)
- **Pre-trade SL distance check**: skip trade if SL < 5 points from entry or > 30 points. Log reason in comment.
- **Always close Pine Editor** before trading: `ui_open_panel pine-editor close`
- **Backtested performance** (2026-05-20):
  - 6 signals generated (expected 4–8/day)
  - 83% win rate (5W-1L)
  - +14 pts gross profit
  - Avg winner: 4 pts (matched 0.75×ATR target)
  - Best for: Range-bound and trending days with low–medium ATR (3–5)
  - Weakness: One whipsaw during extreme panic volatility (unavoidable in crashes)
- **Target**: $300–400/day at 4–8 signals/day with 70%+ win rate
- **Why this works**: Generates 1.5+ trades/hour by bouncing EMA21 instead of waiting for slow EMA crossovers
- **Pre-trade SL distance check**: skip trade if SL < 5 points from entry or > 40 points. Log reason.
- **Always close Pine Editor** before trading: `ui_open_panel pine-editor close`
- **Win rate target**: 65%+ on high-volatility days

### SPX500 ORB-15 — sole strategy (added 2026-05-21 PM)
- **Indicator**: "SPX500 ORB 15" (Pine Script, overlay=false histogram)
- **Asset**: OANDA:SPX500USD, 3m
- **Core Logic**: First 15 min (8:30-8:44 CT) of US cash session defines an opening range. After 8:45 CT, a close above range_high → BUY breakout, below range_low → SELL breakout. Single trade/day (indicator self-locks). Toby Crabel classic edge.
- **Window**: signals only fire 8:45-10:30 CT (max one trade/day)
- **Data window keys**: `Signal`, `OR_high`, `OR_low`, `Range_height`, `ATR_ORB`
- **SL/TP**: SL = opposite side of range; TP = entry + 1.5×range_height (R:R 1.5)
- **Position sizing**: same `min(round(100/|entry-SL|), 5000)` rule, max $100 risk
- **Skip criteria**: SL distance not between 5-30 pts (range too tight or too wide)
- **Why**: Best of the 10-strategy framework — rank #1 in beginner-friendliness AND automation, PF ~1.8, clear rules, single setup/day = no overtrading risk
- **Expected**: 45-55% WR, ~1 trade/day, max ~$150 win or ~$100 loss
- **Cron**: 8:00-10:59 CT, every 3 min (job `a29a8b45`)

### SPX500 ATM Strategy — second HH/HL breakout (added 2026-05-23)
- **Indicator**: "SPX500 ATM Strategy" (Pine Script, overlay=true) — source in `scripts/atm_strategy.pine`
- **Asset**: OANDA:SPX500USD, 3m
- **Core Logic**: Dow theory continuation. Detects sequence prev_HH → HL → second_HH; entry on close > second_HH (long). Mirror for short: prev_LL → LH → second_LL; entry on close < second_LL.
  - **Why second, not first**: First breakouts often trap; the second confirmed HH/HL means trend is real.
  - **BUY signal**: `last_PH > prev_PH AND last_PL > prev_PL AND time-order valid AND close > last_PH`
  - **SELL signal**: `last_PH < prev_PH AND last_PL < prev_PL AND time-order valid AND close < last_PL`
- **Pivot config**: left=3, right=3 (3-bar confirmation each side; ~3-bar signal lag)
- **Stop Loss**: `last opposite pivot` — long SL = `last_PL`, short SL = `last_PH`. Read directly from indicator's `Last_PL` / `Last_PH` data window keys.
- **Take Profit**: `entry ± 2.0 × |entry − SL|` (R:R = 2.0). Computed in cron from current price + SL level (not from indicator).
- **Window**: 08:45–12:00 CT and 12:45–14:00 CT, Mon–Fri (skip open chop and lunch). Indicator self-gates.
- **One trade/day**: indicator self-locks via `taken_today` flag (resets on new day).
- **Data window keys**: `Signal` (1/-1/0), `Last_PH`, `Last_PL`, `Prev_PH`, `Prev_PL`, `Long_Ready`, `Short_Ready`
- **Position sizing**: `min(round(100/|entry-SL|), 5000)` units — same risk model as ORB-15.
- **Skip criteria**: SL distance not in 5–30 pts (too tight = stop-out noise; too wide = risk model breaks). Log reason if skipped.
- **Expected**: ~1 signal/day on trending days, 0 on choppy/range days. R:R 2.0 means 33%+ WR = positive EV.
- **Cron**: 8:00-13:59 CT, every 3 min — see job ID below.

### SPX500 Fib Scalper 1m — Fibonacci retracement scalper (added 2026-05-23)
- **Indicator**: "SPX500 Fib Scalper 1m" (Pine Script, overlay=true) — source in `scripts/fib_scalper.pine`
- **Asset**: OANDA:SPX500USD. **Designed for 1m chart** per the source video; logic is TF-agnostic but signals will be sparse and slow on 3m. Switch the chart to 1m before running the cron, or accept fewer/slower setups on 3m.
- **Core Logic**: Detect short-term trend (HH/HL = uptrend, LH/LL = downtrend) → wait for break of structure (close past last swing) → draw Fib of the BOS leg → signal when price retraces into the 0.5–0.618 "gold zone".
  - **BUY signal**: uptrend (last_PH>prev_PH AND last_PL>prev_PL) AND close > last_PH (up-BOS) AND a later bar tags the 0.5–0.618 retracement of the leg
  - **SELL signal**: downtrend (last_PH<prev_PH AND last_PL<prev_PL) AND close < last_PL (down-BOS) AND a later bar tags the 0.5–0.618 retracement of the leg
- **Pivot config**: left=3, right=3 (3-bar confirmation each side)
- **Stop Loss**: 1.0 retracement of the leg (= origin pivot — `Leg_Low` for longs, `Leg_High` for shorts). Read from indicator's `SL` data window key when Signal fires.
- **Take Profit**: opposite end of the leg (`Leg_High` for longs = the breakout extreme, `Leg_Low` for shorts). Read from indicator's `TP` key.
- **R:R**: ~1.6 from 0.618 entry (default), ~1.0 from 0.5 entry. Below the other strategies but trades fire 6–10×/day on 1m.
- **Window**: 08:30–14:30 CT (US cash session, toggleable via `session_only` input). One signal per setup; setup invalidates on SL hit, TP hit, or fresh opposite BOS.
- **Data window keys**: `Signal` (1/-1/0), `Entry`, `SL`, `TP`, `Long_Ready`, `Short_Ready`, `Leg_Range`, `Leg_High`, `Leg_Low`
- **Position sizing**: `min(round(100/|entry-SL|), 5000)` units — $100 max risk per trade (same model as other strategies).
- **Skip criteria**: SL distance not in 5–30 pts (too tight → noise stops, too wide → blows risk model). Email-log the skip reason.
- **Expected**: 4–10 signals/day on 1m, ~0–2 on 3m. Higher trade count than ATM/ORB but lower R:R; success depends on a trending session.
- **NOT backtested yet** — added 2026-05-23 from the video transcript. Run on replay or paper-trade a day before relying on it.

### SPX500 Tape Reader — bar-based approximation of Jeff Holden's tape-reading framework (added 2026-05-23 PM)
- **Indicator**: "SPX500 Tape Reader" (Pine Script, overlay=true) — source in `scripts/tape_reader.pine`
- **Asset**: OANDA:SPX500USD, 3m
- **NOT loaded by default**: Tape Reader is the 4th SPX500 strategy. Basic plan limits 2 indicators/chart. To activate, swap with one of the active indicators (e.g., replace ATM Strategy on a dedicated chart) and only then create its cron.
- **NOT backtested yet** — added 2026-05-23 PM from the Jeff Holden "Reading the Tape" video transcript.
- **Pine limitation acknowledged**: Holden's framework requires Level 2 (bid/ask depth) and Time & Sales (every print). Pine only has OHLCV bars. The four signals below are bar-based proxies, not the real tape. Treat this as "tape-flavored momentum confirmation" rather than literal tape reading.
- **Core Logic**: Define resistance = highest high last 20 bars, support = lowest low last 20 bars. Require ≥2 tests of the level (absorption). When close crosses the level AND ≥3 of 4 proxy signals fire on the same bar, signal a breakout.
  - **BUY trigger**: `close > resistance AND close[1] <= resistance AND tests_R >= 2 AND long_count >= 3`
  - **SELL trigger**: `close < support AND close[1] >= support AND tests_S >= 2 AND short_count >= 3`
- **Four-signal proxies** (the bar-based approximation of Holden's framework):
  1. **Offer thinning (longs) / Bid thinning (shorts)** — wick rejection shrinking: avg upper-wick of last 3 bars < 0.6× avg upper-wick of bars 3-7. Mirror for lower wick on shorts.
  2. **Sweep order** — wide-range bar: `range > 1.5×ATR(14)` AND close in top 25% (for long sweep) or bottom 25% (for short sweep) of bar AND `volume > 1.8 × sma(volume, 20)`.
  3. **Bid stacking (longs) / Offer stacking (shorts)** — recent lows rising AND pullback depth shrinking (rolling 5-bar window comparison). Mirror for shorts.
  4. **Print acceleration** — `avg(volume, last 3) > 1.5 × sma(volume[3], 10)` (last 3 bars heavier than prior 10).
- **Stop Loss**: `recent 5-bar swing extreme ± 0.25 × ATR(14)`. Long SL = `lowest_low(5) - 0.25×ATR`, short SL = `highest_high(5) + 0.25×ATR`. Read directly from indicator's `SL` data window key.
- **Take Profit**: `entry ± 2.0 × |entry − SL|` (R:R = 2.0). Read from indicator's `TP` data window key.
- **Window**: 08:45–14:00 CT (skip open chop, stop before market-close cleanup). Indicator self-gates.
- **One trade/day**: indicator self-locks via `taken_today` flag (resets on new day).
- **Data window keys**: `Signal` (1/-1/0), `Entry`, `SL`, `TP`, `Resistance`, `Support`, `Tests_R`, `Tests_S`, `Long_Count`, `Short_Count`, `Sig_Offer_Thin`, `Sig_Bid_Thin`, `Sig_Sweep_Up`, `Sig_Sweep_Dn`, `Sig_Bid_Stack`, `Sig_Offer_Stack`, `Sig_Print_Accel`, `Long_Ready`, `Short_Ready`
- **Position sizing**: `min(round(100/|entry-SL|), 5000)` units — $100 max risk per trade (same model as other strategies).
- **Skip criteria**: SL distance not in 5–30 pts. Email-log the skip reason.
- **Expected**: Sparse — needs all 4 conditions (≥2 tests + 3 of 4 signals + breakout) to align. Likely 0–1 signals on quiet days, 1–2 on trending days. Lower frequency but higher conviction than the other strategies. R:R 2.0 means 34%+ WR = positive EV.

**SPX500 Tape Reader (Trade Execution):**
- Expression: `*/3 8-13 * * 1-5` — every 3 min, Mon–Fri, 8:00–13:59 CT
- Job ID: **(create on next "start trading bot" — only if indicator is loaded on a chart)**
- **Pre-req**: indicator must be visible on chart. By default it is NOT loaded (Basic plan 2-indicator limit). Cron must NOT be created unless user explicitly activates Tape Reader on a chart.
- Cron prompt (one-line action when fired):
  > Read `data_get_study_values study_filter="Tape Reader"`. If `Signal` is 0, exit silently. Otherwise: side = "BUY" if Signal=1 else "SELL". Pull `quote_get` for entry price. SL = indicator's `SL` key, TP = indicator's `TP` key. Compute `risk = |entry - SL|`. Skip with email log if risk < 5 or risk > 30. Units = `min(round(100/risk), 5000)`. Run `node scripts/place-trade.js {side} {units} {sl} {tp}` then `node scripts/notify-trade.js {side} {entry} {units} {sl} {tp}`. Indicator self-locks one-trade-per-day; no per-cron dedup needed.
- R:R 2.0 — same risk model as ATM Strategy.

### SPX500 EMA200 Touch — RETIRED (overwritten 2026-05-21)
- **Indicator**: "SPX500 EMA200 Touch" (Pine Script, separate pane)
- **Asset**: OANDA:SPX500USD, 3m (same chart)
- **Core Logic**: Trade EMA200 cross or bounce
  - **BUY signal**: (price crosses above EMA200 OR EMA200 touched within 3 bars and close > EMA200 with positive momentum) AND EMA21 ≥ EMA200 (long-term uptrend)
  - **SELL signal**: (price crosses below EMA200 OR EMA200 touched within 3 bars and close < EMA200 with negative momentum) AND EMA21 ≤ EMA200 (long-term downtrend)
- **Stop Loss**: `EMA200 ± 2.0×ATR` (wider than EMA21 strategy — longer-horizon trade) — computed in cron
- **Take Profit**: `entry ± 3.0×ATR` — R:R = 1.5 (fixed 2026-05-21; indicator's old TP_*_200 fields had R:R 0.75)
- **Data window keys**: `Signal`, `SL_long_200`, `TP_long_200`, `SL_short_200`, `TP_short_200`, `ATR_200`, `EMA200_val_200`
- **Position sizing & risk**: same formula — `min(round(100 / |entry-SL|), 5000)`, max $100 risk per trade
- **Runs INDEPENDENTLY** of the EMA Bounce Scalper. Both may fire same bar → two separate positions.
- **Why added**: On strong-trend days like 2026-05-21, the EMA21 scalper goes quiet because price doesn't pull back to EMA21. EMA200 sees price pull back less often but to a more meaningful S/R level, so it'll catch trades the scalper misses.

### Cron schedules (CURRENT — as of 2026-05-21)
**SPX500 EMA Bounce Scalper (Trade Execution):**
- Expression: `*/3 8-14 * * 1-5` — every 3 min, Mon–Fri, 8:00–14:59 CT
- Job ID: **0a5abfa7** (session-only — recreate on restart via "start trading bot")
- **Time filter**: skip trades during 8:00–8:14 CT (open chop) and 12:00–12:44 CT (lunch)
- Action: Check time → read Signal/EMA21/ATR + price → compute SL=EMA21±1.5×ATR, TP=entry±2.0×ATR (R:R 1.3) → validate SL 5–30 pts → place via place-trade.js → notify
- Calls: `data_get_study_values` + `quote_get` → compute SL/TP → `node scripts/place-trade.js` → `node scripts/notify-trade.js`

**SPX500 ORB-15 (Trade Execution):**
- Expression: `*/3 8-10 * * 1-5` — every 3 min, Mon–Fri, 8:00–10:59 CT
- Job ID: **a29a8b45** (session-only — recreate on restart via "start trading bot")
- **Time gating**: indicator self-locks; only fires Signal between 8:45-10:30 CT, max one signal per day
- Action: Check time (skip if hour=8 AND min<45 — range still forming) → read Signal/OR_high/OR_low/Range_height/ATR_ORB + price → compute SL=opposite range side, TP=entry±1.5×Range_height (R:R 1.5) → validate SL 5–30 pts → place via place-trade.js → notify

**SPX500 ATM Strategy (Trade Execution):**
- Expression: `*/3 8-13 * * 1-5` — every 3 min, Mon–Fri, 8:00–13:59 CT
- Job ID: **(create on next "start trading bot")**
- **Time gating**: indicator self-gates window (8:45-12:00 + 12:45-14:00 CT). Cron skips evaluation if it's before 8:45 CT or in the 12:00-12:44 lunch window (Signal will be 0 anyway).
- Cron prompt (one-line action when fired):
  > Read `data_get_study_values study_filter="ATM Strategy"`. If `Signal` is 0, exit. Otherwise: side = "BUY" if Signal=1 else "SELL". Pull `quote_get` for entry. SL = `Last_PL` (long) or `Last_PH` (short). Compute `risk = |entry - SL|`. Skip with email log if risk < 5 or risk > 30. TP = `entry ± 2.0 × risk`. Units = `min(round(100/risk), 5000)`. Run `node scripts/place-trade.js {side} {units} {sl} {tp}` then `node scripts/notify-trade.js {side} {entry} {units} {sl} {tp}`. Indicator self-locks one-trade-per-day; no need to track in cron.
- R:R 2.0 — sized for 33%+ break-even, target 50-60% WR

**SPX500 Fib Scalper 1m (Trade Execution):**
- Expression: `* 8-14 * * 1-5` — every minute, Mon–Fri, 8:00–14:59 CT (1m strategy needs 1m polling cadence)
- Job ID: **(create on next "start trading bot")**
- **Time gating**: indicator self-gates the 08:30–14:30 CT window. Cron does no extra gating.
- **Pre-req**: chart must be on **1m** timeframe for this strategy to produce its expected 4–10 signals/day. On 3m the cron will run but signals will be sparse and slow. Either keep the chart on 1m all day, or accept the degraded performance.
- Cron prompt (one-line action when fired):
  > Read `data_get_study_values study_filter="Fib Scalper"`. If `Signal` is 0, exit silently. Otherwise: side = "BUY" if Signal=1 else "SELL". Pull `quote_get` for entry price. SL = indicator's `SL` key, TP = indicator's `TP` key. Compute `risk = |entry - SL|`. Skip with email log if risk < 5 or risk > 30. Units = `min(round(100/risk), 5000)`. Run `node scripts/place-trade.js {side} {units} {sl} {tp}` then `node scripts/notify-trade.js {side} {entry} {units} {sl} {tp}`. Indicator invalidates the setup on tag so no per-cron dedup needed.
- R:R ~1.6 (from 0.618 entry default) — needs 38%+ WR for break-even.

**Market Close (daily):**
- Expression: `30 14 * * 1-5` — 2:30 PM CT
- Job ID: **dd31053c** (session-only — recreate on restart via "start trading bot")
- Action: Close all open SPX500USD positions at market, no new orders after this time
- Reason: Avoid overnight gap risk (mandatory every trading day)

**Noon Summary (daily):**
- Expression: `3 12 * * 1-5` — 12:03 PM CT (during lunch trade-skip window)
- Job ID: **150388dd** (session-only — recreate on restart via "start trading bot")
- Action: Email mid-day summary to castoldi@gmail.com with trades so far, P&L, outlook
- Calls: `node scripts/send-summary-email.js "subject" "body"`
- MANDATORY: send even on quiet days; cron prompt explicitly forbids skipping

**EOD Summary (daily):**
- Expression: `35 14 * * 1-5` — 14:35 CT (5 min after market close)
- Job ID: **24ef0677** (session-only — recreate on restart via "start trading bot")
- Action: Email final summary to castoldi@gmail.com with all day's trades, P&L, analysis
- Calls: `node scripts/send-summary-email.js "subject" "body"`
- MANDATORY: send even on quiet days; cron prompt explicitly forbids skipping
- Why 14:35 not 15:00: 3 PM CT was repeatedly missed because cron queues behind ongoing tool work. 14:35 lands during a quiet window right after market close.

### Pre-trade validation (MANDATORY — built into EMA Bounce Scalper indicator logic)
The EMA Bounce Scalper indicator has momentum filtering built in (updated 2026-05-21):
- **BUY signal (1)** fires on: (EMA21 cross up OR bounce off EMA21 from below within 3 bars) AND EMA8 ≥ EMA21
- **SELL signal (-1)** fires on: (EMA21 cross down OR bounce off EMA21 from above within 3 bars) AND EMA8 ≤ EMA21
- EMA200 is plotted for reference only — no longer gates signals
- Simply execute the signal when Signal ≠ 0, verify SL distance (5–30 pts), and trade

### Market close rules (MANDATORY — execute at 2:30 PM CT every trading day)
**Time**: 2:30 PM CT
**Action**: Close all open OANDA:SPX500USD positions immediately — NO EXCEPTIONS
**No new orders** after 2:30 PM CT. EMA Bounce Scalper must stop firing after this time.
**Reason**: Avoid overnight gap risk. Paper trading or live, always exit clean EOD.
- If position is profitable: close at market
- If position is at loss: close at market (cut losses, don't hold overnight)
- If position has open SL/TP: cancel and close at market
- Send final email notification: `node scripts/notify-trade.js CLOSE {exit_price} {position_size} {entry_price} {exit_price} OANDA:SPX500USD`

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`
