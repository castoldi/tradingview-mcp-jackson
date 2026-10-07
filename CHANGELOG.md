# Changelog

Changes to this fork (`castoldi/tradingview-mcp-jackson`), newest first. Upstream history before 2026-05-21 is in `git log`.

Format: one `## YYYY-MM-DD` section per day, grouped under **Added / Changed / Fixed / Removed**. Every commit adds its line here (see "Git workflow" in `CLAUDE.md`).

## 2026-10-07

### Added
- `AGENTS.md`: a generic AI assistant entry point linking to `CLAUDE.md`; clarified in `CLAUDE.md` that it is the shared source of project instructions.

### Changed
- `CLAUDE.md`: "add new trades" always means analyze the current chart and draw new entry plans using the existing "mark entries" workflow, without asking for clarification; it does not request order execution or trade-history import.
- Stop-placement rule in `CLAUDE.md` and the cron prompt: beyond the swing the setup came from, not just past the level (two stops wicked by 1.5-2 pts on 10/06). Today's B short plan moved its stop from 31362 to 31375 (above the 05:00 swing high 31368) with the target extended to 31226; alerts reset.
- `CLAUDE.md`: the LIVE account 2039497 is advice-only for now. Claude never places, modifies or cancels orders there, stops included; the user asked for this on 2026-10-07.
- "Mark entries" step 4 in `CLAUDE.md`: frame with `draw.js now --back 60 --ahead 150`, because the default `--ahead 32` hid the second plan box off-screen (10/07 09:05 redo).

## 2026-10-06

### Added
- `scripts/nnq-scan.js`: a quick NNQ scan for a 1-minute cron. It reads price and 1m/5m bars over CDP and flags watch levels from `journal/levels.json` that were touched or are nearby, so Claude only does a full analysis when price is at a level.
- `scripts/scan-log.js`: logs each bot cron tick (what was done, plus token usage read from the Claude Code session transcript) to `journal/scans.jsonl` and prints the row for the Trade Book.
- NNQ Trade Book page: a "Bot runs" section (today's runs, tokens, a per-run token chart and a runs table) backed by a new `runs` db collection.
- `scripts/draw.js`: a CLI for chart drawings over CDP (list, remove, horizontal line, zone, long/short position), so cron ticks can redraw the plan without the MCP server.

- `scripts/place-order.js`: broker order entry for the NinjaTrader SIM account through TradingView's order panel. It locks to DEMO8197451, verifies qty/TP/SL by read-back and checks the button label before clicking. It also has `POSITIONS` and `CLOSE` (flatten). Added because the user asked Claude to trade NNQ for them in SIM, 1 contract.
- `CLAUDE.md`: an "Autonomous NNQ trading in SIM" section.

- `scripts/place-order.js`: `LIMIT`, `ORDERS`, `CANCEL` and `BALANCE` commands, and caps (risk <= 30 pts, net R:R >= 1.5 after 14.8 pts of SIM fees). A limit entry must rest 2+ pts away from the quote. Tab handling now uses the Account Manager tab ids. Tested live in SIM: placed a far limit with TP/SL, listed it, cancelled it (children cancelled too).
- `scripts/nnq-cron-prompt.md`: the versioned prompt for the autonomous NNQ SIM cron, so it can be re-created after a restart.

- `scripts/draw.js fib`: Fibonacci retracement drawing with the standard 0-at-the-extreme labels, verified on the chart.
- `scripts/fib-data.js` (loads and merges 1m/5m/15m history) and `scripts/fib-backtest.js` (fib limit-entry strategies, single and multi-timeframe, train/test split, `--diag`): research tools only, they place no orders. `CLAUDE.md` has a "Fibonacci tools and research" section with the findings.

- `scripts/fib-backtest.js --boot`: bootstrap intervals per level and fib vs non-fib levels. Result: no level is distinguishable from luck; the fib numbers do not beat arbitrary ones (see `CLAUDE.md`).

- `scripts/draw.js`: `--t0 <time>` for long/short position tools (draw past trades at their real time) and a `text <price> "<label>"` command. Used to draw the day's 3 SIM trades on the chart; `CLAUDE.md` has a "Trade review board" section with the clamping gotcha.

- `scripts/draw.js long|short` now turns the position tool's P&L readout on by default (Stop/Target amounts in dollars, Open/Closed PnL, Qty, Risk/reward) with `--qty`, `--mult`, `--balance`; the day's 3 SIM trades on the chart were updated to show it. `CLAUDE.md` and `scripts/nnq-cron-prompt.md` now say: always use the position tool with its P&L readout for every plan and trade.

- `CLAUDE.md`: closed trades on the review board are drawn with a readable width (about 15-25 min, no horizontal overlap) instead of their true duration; the user deleted the sliver-width boxes.

- `scripts/draw.js`: `frame` (zoom to a CT window and price range) and `verify` (each position tool's entry must lie inside the bar at its drawn time), and the position tool's readout now sets the risk percent (not qty) so Qty reads 1 on every device. Found when the user's Android view showed Qty 3.259 / 4.124 / 9.669 and a zoomed-out piled-up desktop view. `CLAUDE.md` documents the workflow: draw, verify, frame, screenshot; no free-text verdict labels.

- `scripts/alerts.js`: list, delete by id, create and `reset` (delete every alert on the chart's symbol, then create the new plan's alerts and wait for them to arm) over TradingView's alerts REST API. New standing rule in `CLAUDE.md`: whenever entry points are redone, delete the old alerts and create new ones. Deleted the three stale morning alerts (NNQ A/B/C).

- Entry plans are drawn in the future area to the right of price, side by side (`CLAUDE.md`, cron prompt), after the user moved past-anchored boxes there by hand. New plan drawn at 21:12 CT: B short limit 31478 (SL 31496, TP 31412) and A long limit 31412 (SL 31393, TP 31480); alerts reset to those levels.

- `scripts/draw.js now`: zoom/scroll to the latest candles plus empty space on the right for plan boxes. `CLAUDE.md` and the cron prompt: moving the view is allowed and every plan drawing ends with `now` + a screenshot; the approved layout is recorded.

### Changed
- NNQ SIM trader cron disabled by the user (about 11:35 CT); `CLAUDE.md` now says it stays off until they ask.
- NNQ SIM trading rules, after 3 straight stop-outs (-$19.28): limit-only entries at a level, stops sized to the noise, one pending order or position, a $15 daily loss cap, exits followed exactly as written, cron every 3 minutes instead of every minute. `CLAUDE.md` rewritten to match; the loss floor lives in `journal/levels.json`.

### Fixed
- `scripts/nnq-scan.js`: now checks every bar since the previous scan and reports the last closed 15m candle. Before this it only looked at the latest 1m bar and missed the Plan B trigger (15m close above 31540).
- NNQ scan cron: redraws the chart and rewrites `journal/levels.json` whenever the plan changes, because the chart was left showing stale setups after B triggered.

### Added (cont.)
- `CLAUDE.md`: an "NNQ 1-minute scan + bot-run log" section, and the Trade Book's new `runs` collection.

## 2026-10-05

### Added
- `scripts/broker-fills.js`: reads the connected broker account's summary, filled orders and notifications log from TradingView's Account Manager via CDP, so the user's manual trades can be journaled without asking for fills.
- `CLAUDE.md`: "Getting the user's real trades" section covering the live NNQ account, the fills script, how to log to `journal.js`, and how to update the NNQ Trade Book web page (its db collections and fields). Also notes NNQ costs: $0.20/pt and ~$1.88 round trip, about 9.4 pts to break even.

### Changed
- `CLAUDE.md`: the NNQ Trade Book page is now only for executed trades and lessons; advice and planned entries stay in the local journal and on the chart. New "Entry plans go on the chart" rule: draw every entry option as a position tool (NNQ tick 0.5) and remove stale plans.
- `scripts/journal.js`: added `CME_MINI:NNQ1!` = $0.20/pt to `SYMBOL_MULT` (CME E-nano spec), so NNQ trades get $ P&L without `--mult`.

### Fixed
- `src/core/alerts.js`: alert creation now finds TradingView's current `Create alert` button (lowercase "a"); the old `Create Alert` selector matched nothing, so `alert_create` never opened the dialog.
- `CLAUDE.md`: project path updated to `C:\Data\ai_projects\tradingview-mcp-jackson`. The launch instructions now use the PowerShell MSIX method, because the bat script is blocked by App Control, and kill any running instance first so CDP actually comes up. Also notes the MCP server path in `.mcp.json`, which was stale and stopped the MCP server from connecting.

## 2026-10-03

### Added
- `scripts/journal.js`: trading journal that logs trades, reasoning, advice, outcomes, events, skips and lessons to `journal/entries.jsonl`, with a day view at `journal/days/YYYY-MM-DD.md` and `stats` (win rate, pts, P&L, avg R, profit factor, advice hit rate).
- `CLAUDE.md`: "Trading Journal" section saying when to log and with which command; step 3 of trade placement is now "journal it".
- `CLAUDE.md`: "Git workflow" section: always commit and push changes, and keep this changelog.
- `CHANGELOG.md` (this file).

### Changed
- `.gitignore`: ignore `journal/` (personal P&L) and `.claude/scheduled_tasks.lock` (per-session runtime file). The lock file is no longer tracked.

## 2026-10-02

### Added
- NNQ (`CME_MINI:NNQ1!`) day-trading analysis workflow in `CLAUDE.md`, including the mandatory target-reachability check (time left, volume, Friday close).
- Strategies: ATM second HH/HL breakout (`scripts/atm_strategy.pine`), Fib Scalper 1m (`scripts/fib_scalper.pine`), Tape Reader (`scripts/tape_reader.pine`).

### Fixed
- `pine_save_as` now uses the pine-facade API, so it creates a new cloud slot instead of overwriting existing scripts (`src/core/pine.js`, `src/tools/pine.js`).

## 2026-05-21

### Added
- ORB-15 opening-range breakout strategy (`scripts/orb_15.pine`) and EMA200 Touch (`scripts/ema200_touch.pine`, since retired).
- Backtest framework (`scripts/backtest.js`, `scripts/backtest_bars.json`).
- Trading automation: MCP config, `scripts/place-trade.js` (paper order placement via CDP), `scripts/notify-trade.js` and `scripts/send-summary-email.js` (Gmail notifications), bot startup instructions in `CLAUDE.md`.
