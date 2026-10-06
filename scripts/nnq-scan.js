#!/usr/bin/env node
// Quick NNQ scan for the 1-minute cron: price, last bars and which watch levels were touched.
//
// Reads the active chart over CDP (no MCP server needed) and never changes the symbol or timeframe:
// if the chart isn't on NNQ it reports that and exits. Watch levels live in journal/levels.json
// (gitignored), which Claude rewrites whenever the plan changes:
//   { "updated": "2026-10-06 08:45", "levels": [ { "price": 31540, "name": "ATH / B trigger" }, ... ],
//     "zones":  [ { "lo": 31456, "hi": 31470, "name": "Zone A long" } ] }
//
// Usage: node scripts/nnq-scan.js [--near 5]
// Prints one JSON line: { ok, alert, price, last1m, last5m, touched[], near[], ... }
// alert = true when the last 1m bar traded through a level or into a zone, or price is within --near pts.

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as chart from '../src/core/chart.js';
import * as data from '../src/core/data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = join(ROOT, 'journal', 'levels.json');
const TZ = 'America/Chicago';
const args = process.argv.slice(2);
const near = Number(args[args.indexOf('--near') + 1]) || 5;
const ct = sec => new Date(sec * 1000).toLocaleTimeString('en-US', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit' });
const out = o => { console.log(JSON.stringify(o)); process.exit(0); };

try {
  const st = await chart.getState();
  if (!/NNQ/.test(st.symbol || '')) out({ ok: false, alert: false, reason: `chart is on ${st.symbol}, not NNQ` });

  const { bars = [] } = await data.getOhlcv({ count: 30 });
  if (!bars.length) out({ ok: false, alert: false, reason: 'no bars' });
  const tfMin = bars.length > 1 ? Math.round((bars.at(-1).time - bars.at(-2).time) / 60) : 1;
  const last = bars.at(-1);
  const price = last.close;

  // Roll the bars up into the current 5m candle (exact on a 1m chart, approximate otherwise).
  const start5 = Math.floor(last.time / 300) * 300;
  const in5 = bars.filter(b => b.time >= start5);
  const prev5 = bars.filter(b => b.time >= start5 - 300 && b.time < start5);
  const roll = bs => bs.length && { t: ct(bs[0].time), o: bs[0].open, h: Math.max(...bs.map(b => b.high)), l: Math.min(...bs.map(b => b.low)), c: bs.at(-1).close, v: bs.reduce((a, b) => a + (b.volume || 0), 0) };

  const cfg = existsSync(LEVELS) ? JSON.parse(readFileSync(LEVELS, 'utf8')) : { levels: [], zones: [] };
  const touched = [], nearby = [];
  for (const L of cfg.levels || []) {
    if (last.low <= L.price && last.high >= L.price) touched.push(`${L.name} ${L.price}`);
    else if (Math.abs(price - L.price) <= near) nearby.push(`${L.name} ${L.price} (${(price - L.price).toFixed(1)})`);
  }
  for (const Z of cfg.zones || []) {
    if (last.low <= Z.hi && last.high >= Z.lo) touched.push(`${Z.name} ${Z.lo}-${Z.hi}`);
    else if (Math.min(Math.abs(price - Z.lo), Math.abs(price - Z.hi)) <= near) nearby.push(`${Z.name} ${Z.lo}-${Z.hi}`);
  }

  out({
    ok: true,
    alert: touched.length > 0 || nearby.length > 0,
    time: ct(last.time), tf: `${tfMin}m`, price,
    last1m: { o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume },
    last5m: roll(in5), prev5m: roll(prev5),
    touched, near: nearby, levels_updated: cfg.updated || null,
  });
} catch (e) {
  out({ ok: false, alert: false, reason: e.message });
}
