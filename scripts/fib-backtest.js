#!/usr/bin/env node
// Backtest Fibonacci-retracement limit-entry strategies on NNQ bars pulled by scripts/fib-data.js.
//
// Strategy family (long and short, mirror images):
//   1. Find the latest CONFIRMED swing leg on the execution timeframe (fractal pivots with `len` bars each side,
//      zigzag-alternated, leg size >= minLeg points). A leg is only usable once its pivot has closed + confirmed (no look-ahead).
//   2. Place ONE resting limit order at a fib retracement of that leg (0 = leg end, 1 = leg start), in the leg's direction
//      (buy the pullback of an up-leg, sell the bounce of a down-leg).
//   3. SL just beyond the leg start (fib 1.0) plus `slBuf` pts. TP at the leg end plus `tpExt` x leg size (0 = retest of the
//      extreme, 0.272 = fib 1.272, 0.618 = fib 1.618).
//   4. Single-timeframe mode uses a fixed retracement level L. Multi-timeframe ("confluence") mode only takes an entry price
//      where a retracement level of the execution leg lies within `eps` pts of a retracement level of a same-direction leg on
//      EVERY higher timeframe listed.
//
// Execution model (conservative): a limit fills only if price trades 1 tick THROUGH it (opens past it fill at the open);
// when SL and TP are both inside one bar the SL is assumed to hit first; stops fill `slip` pts worse; round-trip fees are
// subtracted from every trade (SIM ~14.8 pts per NNQ contract, LIVE ~9.4). Orders fill only in the session windows
// 08:45-11:30 and 12:45-14:30 CT; open positions are closed at 14:50 CT.
//
// Usage: node scripts/fib-backtest.js [--fee 14.8] [--all-hours] [--min-trades 12] [--top 6]

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'journal', 'fib');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const FEE = Number(opt('--fee', 14.8)), SLIP = 2, TICK = 0.5;
const ALL_HOURS = argv.includes('--all-hours');
const MIN_TRADES = Number(opt('--min-trades', 12)), TOP = Number(opt('--top', 6));
const LEVELS = [0.382, 0.5, 0.618, 0.786];

// ---------- data ----------
const SYMBOL = 'CME_MINI_NNQ1_';
const load = tf => {
  const f = join(DIR, `bars_${SYMBOL}_${tf}.json`);
  if (!existsSync(f)) throw new Error(`missing ${f}; run node scripts/fib-data.js first`);
  const rows = JSON.parse(readFileSync(f, 'utf8')).bars;
  const sec = Number(tf) * 60;
  const ctf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  return rows.map(r => {
    const p = ctf.formatToParts(new Date(r[0] * 1000)); const h = +p.find(x => x.type === 'hour').value, m = +p.find(x => x.type === 'minute').value;
    return { t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], mins: h * 60 + m, sec };
  });
};
const inWindow = m => ALL_HOURS || ((m >= 525 && m < 690) || (m >= 765 && m <= 870)); // 8:45-11:30, 12:45-14:30 CT
const flatTime = m => !ALL_HOURS && m >= 890;                                          // 14:50 CT

// ---------- swing legs (non-repainting events) ----------
function legEvents(bars, len, minLeg) {
  const n = bars.length, ev = [];
  const piv = [];
  for (let i = len; i < n - len; i++) {
    let hi = true, lo = true;
    for (let k = 1; k <= len; k++) {
      if (!(bars[i].h > bars[i - k].h) || !(bars[i].h >= bars[i + k].h)) hi = false;
      if (!(bars[i].l < bars[i - k].l) || !(bars[i].l <= bars[i + k].l)) lo = false;
    }
    if (hi) piv.push({ i, type: 'H', price: bars[i].h });
    if (lo) piv.push({ i, type: 'L', price: bars[i].l });
  }
  piv.sort((a, b) => a.i - b.i || (a.type === 'H' ? -1 : 1));
  let last = null;
  for (const p of piv) {
    const avail = bars[p.i + len].t + bars[0].sec; // confirmed when the bar `len` after the pivot has closed
    if (!last) { last = p; continue; }
    if (p.type === last.type) { // same side: keep the more extreme; the leg from the previous opposite pivot grows
      const better = p.type === 'H' ? p.price > last.price : p.price < last.price;
      if (better) {
        last = { ...p, prev: last.prev };
        if (last.prev) { const r = Math.abs(last.price - last.prev.price); if (r >= minLeg) ev.push({ avail, dir: last.type === 'H' ? 1 : -1, s: last.prev, e: last }); }
      }
    } else { // opposite side: a new leg from `last` to `p`
      const r = Math.abs(p.price - last.price);
      const np = { ...p, prev: last };
      if (r >= minLeg) ev.push({ avail, dir: p.type === 'H' ? 1 : -1, s: last, e: np });
      last = np;
    }
  }
  return ev;
}
const lvlPrice = (leg, L) => leg.dir === 1 ? leg.e.price - L * (leg.e.price - leg.s.price) : leg.e.price + L * (leg.s.price - leg.e.price);

// ---------- simulation ----------
function simulate(bars, evs, cfg, htfEvs = []) {
  const trades = []; let pend = null, pos = null, ei = 0;
  const lastHtf = (list, T, dir, state) => { // latest same-direction leg that was available by T
    while (state.k + 1 < list.length && list[state.k + 1].avail <= T) state.k++;
    for (let k = state.k; k >= Math.max(0, state.k - 6); k--) if (list[k].dir === dir && list[k].avail <= T) return list[k];
    return null;
  };
  const hstate = htfEvs.map(() => ({ k: -1 }));
  for (let j = 0; j < bars.length; j++) {
    const b = bars[j], T = b.t + b.sec;
    // 1. manage open position on this bar
    if (pos) {
      let exit = null;
      const sl = pos.sl, tp = pos.tp;
      if (pos.dir === 1) { if (b.l <= sl) exit = sl - SLIP; else if (b.h >= tp) exit = tp; }
      else { if (b.h >= sl) exit = sl + SLIP; else if (b.l <= tp) exit = tp; }
      if (exit == null && flatTime(b.mins)) exit = b.c;
      if (exit != null) { const pts = pos.dir * (exit - pos.entry); trades.push({ t: pos.t, dir: pos.dir, entry: pos.entry, exit, risk: pos.risk, gross: pts, net: pts - cfg.fee }); pos = null; }
    }
    // 2. fill pending order
    if (!pos && pend && j > pend.j0) {
      if (j - pend.j0 > cfg.expiry || (pend.dir === 1 ? b.l <= pend.slLvl : b.h >= pend.slLvl) || (pend.dir === 1 ? b.h > pend.end : b.l < pend.end) || (!ALL_HOURS && b.mins >= 870)) pend = null;
      else if (inWindow(b.mins)) {
        const touched = pend.dir === 1 ? b.l <= pend.price - TICK : b.h >= pend.price + TICK;
        if (touched) {
          const entry = pend.dir === 1 ? Math.min(pend.price, b.o) : Math.max(pend.price, b.o);
          pos = { dir: pend.dir, entry, sl: pend.sl, tp: pend.tp, risk: Math.abs(entry - pend.sl), t: b.t }; pend = null;
          // same-bar SL / TP check (conservative: SL first)
          let exit = null;
          if (pos.dir === 1) { if (b.l <= pos.sl) exit = pos.sl - SLIP; else if (b.h >= pos.tp) exit = pos.tp; }
          else { if (b.h >= pos.sl) exit = pos.sl + SLIP; else if (b.l <= pos.tp) exit = pos.tp; }
          if (exit != null) { const pts = pos.dir * (exit - pos.entry); trades.push({ t: pos.t, dir: pos.dir, entry: pos.entry, exit, risk: pos.risk, gross: pts, net: pts - cfg.fee }); pos = null; }
        }
      }
    }
    // 3. new leg confirmed at this bar's close: (re)place the pending order
    while (ei < evs.length && evs[ei].avail <= T) {
      const leg = evs[ei++];
      if (pos) continue;
      const range = Math.abs(leg.e.price - leg.s.price);
      let price = null;
      if (!htfEvs.length) price = lvlPrice(leg, cfg.L);
      else {
        const hl = htfEvs.map((list, h) => lastHtf(list, T, leg.dir, hstate[h]));
        if (hl.every(Boolean)) {
          let best = null;
          for (const L of LEVELS) {
            const p = lvlPrice(leg, L);
            let worst = 0, ok = true;
            for (const H of hl) { const d = Math.min(...LEVELS.map(l2 => Math.abs(lvlPrice(H, l2) - p))); if (d > cfg.eps) { ok = false; break; } worst = Math.max(worst, d); }
            if (ok && (!best || Math.abs(L - 0.618) < Math.abs(best.L - 0.618))) best = { L, p };
          }
          if (best) price = best.p;
        }
      }
      if (price == null) continue;
      const dir = leg.dir, end = leg.e.price, start = leg.s.price;
      const sl = dir === 1 ? start - cfg.slBuf : start + cfg.slBuf, tp = dir === 1 ? end + cfg.tpExt * range : end - cfg.tpExt * range;
      if (Math.abs(price - sl) < 4 || Math.abs(tp - price) < 4) continue;
      pend = { dir, price, sl, tp, end, slLvl: start, j0: j };
    }
  }
  return trades;
}

// ---------- stats ----------
function stats(trades) {
  const n = trades.length;
  if (!n) return { n: 0, win: 0, avgNet: 0, totNet: 0, totGross: 0, avgR: 0, dd: 0 };
  let eq = 0, peak = 0, dd = 0;
  for (const t of trades) { eq += t.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const win = trades.filter(t => t.net > 0).length / n;
  const totNet = trades.reduce((a, t) => a + t.net, 0), totGross = trades.reduce((a, t) => a + t.gross, 0);
  const avgR = trades.reduce((a, t) => a + t.net / (t.risk + SLIP), 0) / n;
  return { n, win: +(win * 100).toFixed(0), avgNet: +(totNet / n).toFixed(1), totNet: +totNet.toFixed(0), totGross: +totGross.toFixed(0), avgR: +avgR.toFixed(2), dd: +dd.toFixed(0) };
}
const fmt = s => `n=${String(s.n).padStart(3)} win=${String(s.win).padStart(3)}% avgNet=${String(s.avgNet).padStart(6)}pts totNet=${String(s.totNet).padStart(6)} (gross ${String(s.totGross).padStart(6)}) avgR=${String(s.avgR).padStart(5)} dd=${s.dd}`;

// ---------- sweeps ----------
const bars = { 1: load('1'), 5: load('5'), 15: load('15') };
const span = tf => `${new Date(bars[tf][0].t * 1000).toISOString().slice(0, 10)} to ${new Date(bars[tf].at(-1).t * 1000).toISOString().slice(0, 10)}`;
console.log(`Data: 1m ${bars[1].length} bars (${span(1)}), 5m ${bars[5].length} (${span(5)}), 15m ${bars[15].length} (${span(15)}). Fees ${FEE} pts/trade, slip ${SLIP}, ${ALL_HOURS ? 'ALL HOURS' : 'RTH windows only'}.`);

const sets = {
  1: { len: [2, 3, 5], minLeg: [20, 30, 45], expiry: 40 },
  5: { len: [2, 3, 5], minLeg: [30, 45, 70], expiry: 15 },
  15: { len: [2, 3], minLeg: [60, 90, 130], expiry: 8 },
};
const results = [];
const evCache = new Map();
const evFor = (tf, len, minLeg) => { const k = `${tf}-${len}-${minLeg}`; if (!evCache.has(k)) evCache.set(k, legEvents(bars[tf], len, minLeg)); return evCache.get(k); };
const splitT = tf => bars[tf][Math.floor(bars[tf].length * 0.6)].t;
const run = (name, tf, evs, cfg, htf) => {
  const tr = simulate(bars[tf], evs, { fee: FEE, ...cfg }, htf);
  const cut = splitT(tf);
  results.push({ name, tf, cfg, all: stats(tr), train: stats(tr.filter(t => t.t < cut)), test: stats(tr.filter(t => t.t >= cut)), trades: tr });
};

// Single timeframe
for (const tf of [1, 5, 15]) {
  const S = sets[tf];
  for (const len of S.len) for (const minLeg of S.minLeg) {
    const evs = evFor(tf, len, minLeg);
    for (const L of LEVELS) for (const tpExt of [0, 0.272, 0.618])
      run(`${tf}m single`, tf, evs, { L, tpExt, slBuf: 2, expiry: S.expiry, len, minLeg });
  }
}
// Multi timeframe confluence: 5m execution + 15m; 1m execution + 5m + 15m
for (const len of [2, 3]) for (const minLeg of [30, 45, 70]) for (const hMin of [60, 90, 130]) for (const eps of [3, 6]) for (const tpExt of [0, 0.272, 0.618])
  run('5m+15m confluence', 5, evFor(5, len, minLeg), { tpExt, slBuf: 2, expiry: 15, eps, len, minLeg, hMin }, [evFor(15, 2, hMin)]);
for (const len of [2, 3]) for (const minLeg of [20, 30, 45]) for (const eps of [3, 6]) for (const tpExt of [0, 0.272, 0.618])
  run('1m+5m+15m confluence', 1, evFor(1, len, minLeg), { tpExt, slBuf: 2, expiry: 40, eps, len, minLeg }, [evFor(5, 2, 45), evFor(15, 2, 90)]);

// ---------- report ----------
const groups = [...new Set(results.map(r => r.name))];
const out = { fee: FEE, all_hours: ALL_HOURS, groups: {} };
for (const g of groups) {
  const R = results.filter(r => r.name === g);
  const gross = R.filter(r => r.all.n >= MIN_TRADES);
  const posGross = gross.filter(r => r.all.totGross > 0).length;
  const posNet = gross.filter(r => r.all.totNet > 0).length;
  console.log(`\n=== ${g}: ${R.length} configs, ${gross.length} with >=${MIN_TRADES} trades; gross-positive ${posGross}, NET-positive ${posNet} ===`);
  const ranked = R.filter(r => r.train.n >= Math.ceil(MIN_TRADES * 0.6)).sort((a, b) => b.train.avgNet - a.train.avgNet).slice(0, TOP);
  console.log(' Best on the first 60% of the data (train), then how each did on the unseen last 40% (test):');
  for (const r of ranked) {
    const c = r.cfg;
    console.log(`  L=${c.L ?? 'confl'} tp+${c.tpExt} len=${c.len} leg>=${c.minLeg}${c.hMin ? ' h>=' + c.hMin : ''}${c.eps ? ' eps=' + c.eps : ''}`);
    console.log(`     train ${fmt(r.train)}\n     test  ${fmt(r.test)}`);
  }
  const avgAll = stats(R.flatMap(r => r.trades));
  console.log(` Every config pooled (no cherry-picking): ${fmt(avgAll)}`);
  out.groups[g] = { configs: R.length, pooled: avgAll, best_train: ranked.map(r => ({ cfg: r.cfg, train: r.train, test: r.test })) };
}
writeFileSync(join(DIR, `results_fee${FEE}${ALL_HOURS ? '_allhours' : ''}.json`), JSON.stringify(out, null, 1));

// ---------- diagnostics: is it the Fibonacci levels, or just the market drifting up? ----------
if (argv.includes('--diag')) {
  console.log('\n######## DIAGNOSTICS ########');
  for (const tf of [1, 5, 15]) {
    const b = bars[tf]; const hi = Math.max(...b.map(x => x.h)), lo = Math.min(...b.map(x => x.l));
    console.log(`Market over the ${tf}m data: close ${b[0].c} -> ${b.at(-1).c} (${(b.at(-1).c - b[0].c).toFixed(0)} pts), range ${lo}-${hi}`);
  }
  const probe = (tf, len, minLeg, expiry, label) => {
    console.log(`\n-- ${label}: levels compared on identical legs (TP at the leg end, SL beyond the leg start, fees ${FEE}) --`);
    const evs = evFor(tf, len, minLeg);
    for (const L of [0.2, 0.3, 0.382, 0.45, 0.5, 0.55, 0.618, 0.7, 0.786, 0.9]) {
      const tr = simulate(bars[tf], evs, { fee: FEE, L, tpExt: 0, slBuf: 2, expiry }, []);
      const lg = tr.filter(t => t.dir === 1), sh = tr.filter(t => t.dir === -1);
      console.log(`  L=${String(L).padEnd(5)} all ${fmt(stats(tr))}\n           longs  ${fmt(stats(lg))}\n           shorts ${fmt(stats(sh))}`);
    }
  };
  probe(15, 3, 130, 8, '15m, len 3, leg >= 130');
  probe(5, 5, 45, 15, '5m, len 5, leg >= 45');
}

// ---------- bootstrap: could these results be luck? ----------
if (argv.includes('--boot')) {
  console.log('\n######## BOOTSTRAP (95% interval of the mean net pts per trade; resampling the trades 5,000 times) ########');
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const ci = arr => {
    const n = arr.length; if (n < 5) return null;
    const means = []; for (let k = 0; k < 5000; k++) { let s = 0; for (let i = 0; i < n; i++) s += arr[Math.floor(rnd() * n)]; means.push(s / n); }
    means.sort((a, b) => a - b); const m = arr.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
    return { n, mean: +m.toFixed(1), lo: +means[125].toFixed(1), hi: +means[4875].toFixed(1), t: +(m / (sd / Math.sqrt(n))).toFixed(2) };
  };
  const line = (label, tr) => { const c = ci(tr.map(t => t.net)); console.log(`  ${label.padEnd(34)} ${c ? `n=${c.n} mean ${c.mean} pts  95% [${c.lo}, ${c.hi}]  t=${c.t}  ${c.lo > 0 ? 'EXCLUDES 0' : 'includes 0 (not distinguishable from luck)'}` : 'too few trades'}`); };
  for (const [tf, len, minLeg, exp] of [[15, 3, 130, 8], [5, 5, 45, 15]]) {
    console.log(`\n${tf}m, len ${len}, leg >= ${minLeg}, TP at the leg end, fees ${FEE}:`);
    const evs = evFor(tf, len, minLeg);
    const by = {};
    for (const L of [0.3, 0.382, 0.45, 0.5, 0.55, 0.618, 0.7, 0.786]) by[L] = simulate(bars[tf], evs, { fee: FEE, L, tpExt: 0, slBuf: 2, expiry: exp }, []);
    for (const L of Object.keys(by)) line(`level ${L}`, by[L]);
    const fibSet = [0.382, 0.5, 0.618, 0.786], other = [0.3, 0.45, 0.55, 0.7];
    line('FIB levels pooled', fibSet.flatMap(L => by[L]));
    line('NON-fib levels pooled', other.flatMap(L => by[L]));
    // same sample: gross (before fees) for the pooled sets
    const g = set => set.flatMap(L => by[L]).map(t => t.gross);
    const cf = ci(g(fibSet)), co = ci(g(other));
    console.log(`  gross before fees: fib mean ${cf?.mean} pts vs non-fib ${co?.mean} pts`);
  }
}
