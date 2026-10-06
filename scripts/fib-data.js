#!/usr/bin/env node
// Pull as much history as the chart will give for the 1m / 5m / 15m timeframes of the active symbol and save it to
// journal/fib/bars_<symbol>_<tf>.json (gitignored). Used by scripts/fib-backtest.js.
//
// How: zooming the time scale far to the left makes TradingView load older bars; the loop repeats until the bar count
// stops growing. The chart's timeframe is switched for each pull and put back at the end (symbol is never changed).
//
// Each run MERGES into the saved files (deduped by timestamp), so running it daily after the close grows the sample.
// Usage: node scripts/fib-data.js [--tfs 1,5,15] [--max-rounds 10]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { evaluate, KNOWN_PATHS } from '../src/connection.js';
import * as chart from '../src/core/chart.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'journal', 'fib');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const tfs = flag('--tfs', '1,5,15').split(',');
const maxRounds = Number(flag('--max-rounds', 10));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const size = () => evaluate(`(function(){ var b=${KNOWN_PATHS.mainSeriesBars}; return b.size(); })()`);
const zoomLeft = () => evaluate(`(function(){ var m=${KNOWN_PATHS.chartApi}._chartWidget.model(); var ts=m.timeScale(); var b=m.mainSeries().bars(); ts.zoomToBarsRange(b.firstIndex()-4000, b.lastIndex()); })()`);
const dump = () => evaluate(`(function(){
  var b=${KNOWN_PATHS.mainSeriesBars}, f=b.firstIndex(), l=b.lastIndex(), out=[];
  for (var i=f;i<=l;i++){ var v=b.valueAt(i); if (v) out.push([v[0],v[1],v[2],v[3],v[4],v[5]||0]); }
  return out; })()`);

try {
  const st = await chart.getState();
  const symbol = st.symbol, orig = String(st.resolution ?? st.timeframe ?? '1');
  mkdirSync(OUT, { recursive: true });
  const summary = {};
  for (const tf of tfs) {
    await chart.setTimeframe({ timeframe: tf });
    await sleep(3000);
    let prev = -1, rounds = 0;
    while (rounds < maxRounds) {
      await zoomLeft();
      await sleep(4000);
      const n = await size();
      rounds++;
      if (n === prev) break;
      prev = n;
    }
    let rows = await dump();
    const file = join(OUT, `bars_${symbol.replace(/[^A-Za-z0-9]/g, '_')}_${tf}.json`);
    // Merge with what earlier runs saved, so the history keeps growing past the ~2,500-bar cap TradingView serves per pull.
    let kept = 0;
    if (existsSync(file)) {
      const old = JSON.parse(readFileSync(file, 'utf8')).bars || [];
      const byT = new Map(old.map(r => [r[0], r]));
      for (const r of rows) byT.set(r[0], r);
      kept = old.length;
      rows = [...byT.values()].sort((a, b) => a[0] - b[0]);
    }
    writeFileSync(file, JSON.stringify({ symbol, tf, bars: rows }));
    summary[tf] = { bars: rows.length, previously_saved: kept, from: new Date(rows[0][0] * 1000).toISOString(), to: new Date(rows.at(-1)[0] * 1000).toISOString(), rounds };
  }
  await chart.setTimeframe({ timeframe: orig });
  await sleep(1500);
  await evaluate(`(function(){ var m=${KNOWN_PATHS.chartApi}._chartWidget.model(); var ts=m.timeScale(); var b=m.mainSeries().bars(); ts.zoomToBarsRange(b.lastIndex()-120, b.lastIndex()+8); })()`);
  console.log(JSON.stringify({ ok: true, symbol, restored_tf: orig, summary }, null, 1));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e.message }));
}
process.exit(0);
