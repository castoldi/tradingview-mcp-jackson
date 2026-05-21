# TradingView MCP — Claude Instructions

68 tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Environment (this machine)

| Setting | Value |
|---------|-------|
| OS | Windows 11 Home 10.0.26200 |
| User | `casto` |
| Project path | `C:\users\casto\tradingview-mcp-jackson` |
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
2. `pine_new` → create blank indicator/strategy/library
3. `pine_set_source` → inject code into editor (always use `//@version=6`, not v5)
4. `pine_smart_compile` → compile with auto-detection + error check
5. `pine_get_errors` → read compilation errors
6. `pine_get_console` → read log.info() output
7. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
8. `pine_save` → save to TradingView cloud
9. `pine_open` → load a saved script by name

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
- **Always run the bat script** (handles MSIX auto-detection, kills existing instances, waits for CDP ready):
  ```powershell
  & "C:\users\casto\tradingview-mcp-jackson\scripts\launch_tv_debug.bat"
  ```
  Optional custom port: `scripts\launch_tv_debug.bat 9223`
- The script blocks until `http://localhost:9222/json/version` responds — when it returns, CDP is ready.
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
6. Create cron jobs (local CT time, Mon–Fri):
   - **ORB-15 (only active strategy)**: `CronCreate cron: "*/3 8-10 * * 1-5"` (8:30-8:44 forms range, signals fire 8:45-10:30 CT, one trade/day max)
   - **Market Close**: `CronCreate cron: "30 14 * * 1-5"` (close all SPX500 positions at 2:30 PM CT)
   - **Noon Summary**: `CronCreate cron: "0 12 * * 1-5"` (email trading summary)
   - **EOD Summary**: `CronCreate cron: "0 15 * * 1-5"` (email trading summary)
   - EMA Bounce Scalper retired 2026-05-21 (0/4 WR).
   - EMA200 Touch indicator accidentally overwritten 2026-05-21 PM during ORB pine_new flow; cron deleted. Restore via Pine UI Save-As if needed.
   - User is in **St. Louis, CT — CDT (UTC-5) in summer, CST (UTC-6) in winter**
   - Cron uses local time so DST is handled automatically — the expression never needs to change between seasons
7. Report the four new cron job IDs and confirm all systems are live

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

## Active Trading Setup (this account)

| Setting | Value |
|---------|-------|
| Layout | AUGUSTO |
| Broker | Paper Trading |
| Account | accastoldi USD (~$99,929 balance) |
| Active symbol | OANDA:SPX500USD, 3m |
| Indicators | "SPX500 ORB 15" (sole indicator as of 2026-05-21 PM; EMA200 Touch script was accidentally overwritten and pine_new doesn't support Save-As) |
| Trading hours | 8:00 AM - 2:30 PM CT (close all positions by 2:30 PM CT mandatory) |
| Active cron loops | ORB-15 only + market close + summaries |

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
- Sole active strategy as of 2026-05-21 PM

**Market Close (daily):**
- Expression: `30 14 * * 1-5` — 2:30 PM CT
- Job ID: **dd31053c** (session-only — recreate on restart via "start trading bot")
- Action: Close all open SPX500USD positions at market, no new orders after this time
- Reason: Avoid overnight gap risk (mandatory every trading day)

**Noon Summary (daily):**
- Expression: `0 12 * * 1-5` — 12:00 PM CT (noon)
- Job ID: **336f5e69** (session-only — recreate on restart via "start trading bot")
- Action: Email mid-day summary to castoldi@gmail.com with trades so far, P&L, outlook
- Calls: `node scripts/send-summary-email.js "subject" "body"`

**EOD Summary (daily):**
- Expression: `0 15 * * 1-5` — 3:00 PM CT
- Job ID: **3e09636d** (session-only — recreate on restart via "start trading bot")
- Action: Email final summary to castoldi@gmail.com with all day's trades, P&L, analysis
- Calls: `node scripts/send-summary-email.js "subject" "body"`

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
