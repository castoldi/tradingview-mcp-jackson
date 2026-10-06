# Changelog

Changes to this fork (`castoldi/tradingview-mcp-jackson`), newest first. Upstream history before 2026-05-21 is in `git log`.

Format: one `## YYYY-MM-DD` section per day, grouped under **Added / Changed / Fixed / Removed**. Every commit adds its line here (see "Git workflow" in `CLAUDE.md`).

## 2026-10-05

### Fixed
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
