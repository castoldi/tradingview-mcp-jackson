#!/usr/bin/env node
// Backtest a mechanical version of the "trendline bounce" (Tori Trades, docs/2026-10-10_tori-trades-trendline-bounce.md)
// on the NNQ bars saved by scripts/fib-data.js (journal/fib/).
//
// Rules (long side; shorts run the same code on price-mirrored bars):
//   1. Line: when a pivot low B is confirmed (`len` bars each side, no look-ahead), connect it to an earlier pivot low A
//      (lower than B, at most LOOK bars back) and keep the STEEPEST such line whose span A..B has no bar CLOSING below it
//      (her rule 1: price may not cut through the line). The newest valid line is the "action line".
//   2. Arm: price must first move `away` pts above the line after B (a real bounce off B).
//   3. Entry: resting buy limit at line + `off`, moved with the line each bar; fills only if price trades 1 tick through it,
//      inside the RTH entry windows (08:45-11:30, 12:45-14:30 CT).
//   4. Stop: `tori` = line - buf at the fill (her "just below the line"); `swing` = B - buf (this repo's 2026-10-07 rule:
//      beyond the swing low the setup came from). Skipped if risk > maxRisk (place-order.js caps at 30) or < 4.
//   5. Exit: trail the stop to (each new pivot low confirmed after entry) - buf; exit at the close of the first bar that
//      CLOSES below the line; stops fill `SLIP` worse (gaps at the open); flat at 14:50 CT. No profit target.
//   Fees (default 14.8 pts, the SIM round trip) are subtracted from every trade.
//
// Usage: node scripts/trendline-backtest.js [--fee 14.8] [--all-hours]

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'journal', 'fib');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const FEE = Number(opt('--fee', 14.8)), SLIP = 2, TICK = 0.5, LOOK = 150;
const ALL_HOURS = argv.includes('--all-hours');

const load = tf => {
  const f = join(DIR, `bars_CME_MINI_NNQ1__${tf}.json`);
  if (!existsSync(f)) throw new Error(`missing ${f}; run node scripts/fib-data.js first`);
  const ctf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  return JSON.parse(readFileSync(f, 'utf8')).bars.map(r => {
    const p = ctf.formatToParts(new Date(r[0] * 1000));
    return { t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], mins: +p.find(x => x.type === 'hour').value * 60 + +p.find(x => x.type === 'minute').value };
  });
};
const mirror = bars => bars.map(b => ({ ...b, o: -b.o, h: -b.l, l: -b.h, c: -b.c }));
const inWindow = m => ALL_HOURS || (m >= 525 && m < 690) || (m >= 765 && m <= 870);
const flatTime = m => !ALL_HOURS && m >= 890;

function pivotLows(bars, len) {
  const out = [];
  for (let i = len; i < bars.length - len; i++) {
    let ok = true;
    for (let k = 1; k <= len && ok; k++) if (!(bars[i].l < bars[i - k].l) || !(bars[i].l <= bars[i + k].l)) ok = false;
    if (ok) out.push({ i, price: bars[i].l, conf: i + len });
  }
  return out;
}
const at = (ln, j) => ln.B.price + ln.slope * (j - ln.B.i);

function simulate(bars, cfg, dir) {
  const piv = pivotLows(bars, cfg.len), known = [], trades = [];
  let pk = 0, line = null, pos = null;
  const close = (j, exit, why) => {
    const pts = exit - pos.entry;
    trades.push({ t: bars[pos.j].t, dir, entry: dir * pos.entry, risk: pos.risk, gross: pts, net: pts - cfg.fee, bars: j - pos.j, why });
    pos = null;
  };
  for (let j = 0; j < bars.length; j++) {
    const b = bars[j];
    // 1. manage the open position on this bar
    if (pos && j > pos.j) {
      if (b.o <= pos.sl) close(j, b.o - SLIP, 'stop-gap');
      else if (b.l <= pos.sl) close(j, pos.sl - SLIP, 'stop');
      else if (b.c < at(pos.line, j)) close(j, b.c, 'line-close');
      else if (flatTime(b.mins)) close(j, b.c, 'flat');
    }
    // 2. resting limit at the action line
    if (!pos && line && line.armed && j > line.made && inWindow(b.mins)) {
      const lim = at(line, j) + cfg.off;
      if (b.l <= lim - TICK) {
        const entry = Math.min(lim, b.o);
        const sl = cfg.stop === 'tori' ? at(line, j) - cfg.buf : line.B.price - cfg.buf;
        const risk = entry - sl;
        if (risk >= 4 && risk <= cfg.maxRisk) {
          pos = { j, entry, sl, risk, line };
          if (b.l <= sl) close(j, sl - SLIP, 'stop'); // conservative: same-bar stop first
          else if (b.c < at(line, j)) close(j, b.c, 'line-close');
          line.armed = false; // a re-entry on the same line needs a fresh bounce
        }
      }
    }
    // 3. line state at this bar's close
    if (line) {
      if (b.c < at(line, j)) line = null;
      else if (b.h - at(line, j) >= cfg.away) line.armed = true;
    }
    // 4. pivots confirmed at this close: trail an open position, or draw a new action line
    while (pk < piv.length && piv[pk].conf === j) {
      const B = piv[pk++]; known.push(B);
      if (pos) { if (B.i > pos.j && B.price - cfg.buf > pos.sl) pos.sl = B.price - cfg.buf; continue; }
      let best = null;
      for (const A of known) {
        if (A.i >= B.i || B.i - A.i > LOOK || A.price >= B.price) continue;
        const ln = { A, B, slope: (B.price - A.price) / (B.i - A.i) };
        let ok = true;
        for (let k = A.i + 1; k <= j && ok; k++) if (bars[k].c < at(ln, k)) ok = false;
        if (ok && (!best || ln.slope > best.slope)) best = ln;
      }
      if (best) line = { ...best, made: j, armed: false };
    }
  }
  return trades;
}

function stats(tr) {
  const n = tr.length;
  if (!n) return { n: 0 };
  const sum = k => tr.reduce((a, t) => a + t[k], 0);
  const wins = tr.filter(t => t.net > 0), losses = tr.filter(t => t.net <= 0);
  const R = tr.map(t => t.gross / (t.risk + SLIP));
  return {
    n, win: Math.round(wins.length / n * 100), avgNet: +(sum('net') / n).toFixed(1), avgGross: +(sum('gross') / n).toFixed(1),
    totNet: Math.round(sum('net')), avgRisk: +(sum('risk') / n).toFixed(1),
    avgWin: wins.length ? +(wins.reduce((a, t) => a + t.net, 0) / wins.length).toFixed(1) : 0,
    avgLoss: losses.length ? +(losses.reduce((a, t) => a + t.net, 0) / losses.length).toFixed(1) : 0,
    bigR: R.filter(r => r >= 5).length, maxR: +Math.max(...R).toFixed(1),
  };
}
const fmt = s => s.n ? `n=${String(s.n).padStart(4)} win=${String(s.win).padStart(3)}% gross/tr=${String(s.avgGross).padStart(6)} net/tr=${String(s.avgNet).padStart(6)} totNet=${String(s.totNet).padStart(6)} risk=${s.avgRisk} avgW=${s.avgWin} avgL=${s.avgLoss} >=5R:${s.bigR} maxR=${s.maxR}` : 'n=0';
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
function ci(arr) {
  if (arr.length < 5) return 'too few trades';
  const means = [];
  for (let k = 0; k < 5000; k++) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[Math.floor(rnd() * arr.length)]; means.push(s / arr.length); }
  means.sort((a, b) => a - b);
  return `95% [${means[125].toFixed(1)}, ${means[4875].toFixed(1)}] ${means[125] > 0 ? 'EXCLUDES 0' : means[4875] < 0 ? 'BELOW 0' : 'includes 0'}`;
}

const span = b => `${new Date(b[0].t * 1000).toISOString().slice(0, 10)}..${new Date(b.at(-1).t * 1000).toISOString().slice(0, 10)}`;
console.log(`NNQ trendline bounce. Fees ${FEE} pts/trade, stop slip ${SLIP}, ${ALL_HOURS ? 'ALL HOURS' : 'RTH entry windows, flat 14:50 CT'}.`);
for (const tf of [1, 5, 15]) {
  const up = load(tf), dn = mirror(up);
  console.log(`\n======== ${tf}m: ${up.length} bars, ${span(up)}, close ${up[0].c} -> ${up.at(-1).c} ========`);
  for (const stop of ['tori', 'swing']) {
    const all = [], cfgRows = [];
    for (const len of [2, 3, 5]) for (const off of [0, 2]) for (const away of [10, 20]) for (const maxRisk of [30, 1e9])
      for (const buf of stop === 'tori' ? [1, 3] : [3, 6]) {
        const cfg = { len, off, away, maxRisk, buf, stop, fee: FEE };
        const tr = [...simulate(up, cfg, 1), ...simulate(dn, cfg, -1)];
        all.push(...tr); cfgRows.push({ cfg, s: stats(tr) });
      }
    const pos = cfgRows.filter(r => r.s.n >= 10), netPos = pos.filter(r => r.s.totNet > 0).length;
    console.log(`\n-- stop=${stop} (${stop === 'tori' ? 'just beyond the line' : 'beyond the swing low B'}): ${cfgRows.length} configs, ${netPos} of ${pos.length} with n>=10 net-positive`);
    console.log(`   pooled  ${fmt(stats(all))}`);
    console.log(`   longs   ${fmt(stats(all.filter(t => t.dir === 1)))}`);
    console.log(`   shorts  ${fmt(stats(all.filter(t => t.dir === -1)))}`);
    console.log(`   pooled net pts/trade ${ci(all.map(t => t.net))}  (configs overlap, so the true interval is wider)`);
    const ex = {}; for (const t of all) ex[t.why] = (ex[t.why] || 0) + 1;
    console.log(`   exits ${JSON.stringify(ex)}`);
    const best = cfgRows.filter(r => r.s.n >= 10).sort((a, b) => b.s.avgNet - a.s.avgNet).slice(0, 3);
    for (const r of best) console.log(`   best: len=${r.cfg.len} off=${r.cfg.off} away=${r.cfg.away} buf=${r.cfg.buf} maxRisk=${r.cfg.maxRisk > 1e6 ? 'none' : r.cfg.maxRisk}  ${fmt(r.s)}`);
  }
}
