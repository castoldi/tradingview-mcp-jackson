#!/usr/bin/env node
// Backtest EMA Bounce Scalper v3 (R:R 1.3) and EMA200 Touch (R:R 1.5) against pulled bars.
// Reads bars from scripts/backtest_bars.json (array of {time, open, high, low, close, volume}).
// Applies time filter: skip 8:00-8:14 CT and 12:00-12:44 CT.
// Treats local Windows clock = Central Time (system is CT/CDT).

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bars = JSON.parse(readFileSync(join(__dirname, 'backtest_bars.json'), 'utf8'));

// ----- EMA helper -----
function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    const v = values[i] * k + prev * (1 - k);
    out.push(v);
    prev = v;
  }
  return out;
}

// ----- ATR (Wilder, 14) -----
function atr14(bars) {
  const out = [];
  const trs = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const tr = i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i-1].close), Math.abs(b.low - bars[i-1].close));
    trs.push(tr);
    if (i < 14) {
      out.push(NaN);
    } else if (i === 14) {
      const sum = trs.slice(1, 15).reduce((a,b)=>a+b, 0);
      out.push(sum / 14);
    } else {
      out.push((out[i-1] * 13 + tr) / 14);
    }
  }
  return out;
}

const closes = bars.map(b => b.close);
const ema8 = ema(closes, 8);
const ema21 = ema(closes, 21);
const ema200 = ema(closes, 200);
const atr = atr14(bars);

// Bar time in CT (local Windows time). Unix seconds -> Date with America/Chicago.
function ctTime(unixSec) {
  const d = new Date(unixSec * 1000);
  // Quick & dirty: assume CDT (UTC-5) for May. (Today is 2026-05-21.)
  const ctMs = d.getTime() - 5 * 3600 * 1000;
  const ctDate = new Date(ctMs);
  return {
    hour: ctDate.getUTCHours(),
    minute: ctDate.getUTCMinutes(),
    dateStr: `${ctDate.getUTCFullYear()}-${String(ctDate.getUTCMonth()+1).padStart(2,'0')}-${String(ctDate.getUTCDate()).padStart(2,'0')}`,
    timeStr: `${String(ctDate.getUTCHours()).padStart(2,'0')}:${String(ctDate.getUTCMinutes()).padStart(2,'0')}`,
  };
}

function inTradingWindow(t) {
  // 8:00 - 14:30 CT, skip 8:00-8:14 and 12:00-12:44
  const minutesFromMidnight = t.hour * 60 + t.minute;
  if (minutesFromMidnight < 8 * 60 + 15) return false;        // pre-8:15 (open chop or pre-market)
  if (minutesFromMidnight >= 14 * 60 + 30) return false;       // after 2:30 close
  if (minutesFromMidnight >= 12 * 60 && minutesFromMidnight < 12 * 60 + 45) return false; // lunch chop
  return true;
}

// ----- Strategy 1: EMA Bounce Scalper v3 -----
function signalScalper(i) {
  if (i < 200 || isNaN(atr[i])) return 0;
  const b = bars[i];
  const e8 = ema8[i], e21 = ema21[i];
  const prevB = bars[i-1];
  const prevClose = bars[i-1].close;
  const crossAbove = b.close > e21 && prevClose <= ema21[i-1];
  const crossBelow = b.close < e21 && prevClose >= ema21[i-1];
  const touchedBelow = b.low <= e21 || bars[i-1].low <= ema21[i-1] || bars[i-2].low <= ema21[i-2];
  const touchedAbove = b.high >= e21 || bars[i-1].high >= ema21[i-1] || bars[i-2].high >= ema21[i-2];
  const bounceUp = touchedBelow && b.close > e21 && b.close > prevClose;
  const bounceDown = touchedAbove && b.close < e21 && b.close < prevClose;
  const momUp = e8 >= e21;
  const momDown = e8 <= e21;
  if ((crossAbove || bounceUp) && momUp) return 1;
  if ((crossBelow || bounceDown) && momDown) return -1;
  return 0;
}

// ----- Strategy 2: EMA200 Touch -----
function signal200(i) {
  if (i < 200 || isNaN(atr[i])) return 0;
  const b = bars[i];
  const e200 = ema200[i], e21 = ema21[i];
  const prevClose = bars[i-1].close;
  const crossAbove = b.close > e200 && prevClose <= ema200[i-1];
  const crossBelow = b.close < e200 && prevClose >= ema200[i-1];
  const touchedBelow = b.low <= e200 || bars[i-1].low <= ema200[i-1] || bars[i-2].low <= ema200[i-2];
  const touchedAbove = b.high >= e200 || bars[i-1].high >= ema200[i-1] || bars[i-2].high >= ema200[i-2];
  const bounceUp = touchedBelow && b.close > e200 && b.close > prevClose;
  const bounceDown = touchedAbove && b.close < e200 && b.close < prevClose;
  const trendUp = e21 >= e200;
  const trendDown = e21 <= e200;
  if ((crossAbove || bounceUp) && trendUp) return 1;
  if ((crossBelow || bounceDown) && trendDown) return -1;
  return 0;
}

// ----- Trade simulator: enter at bar i+1 open, scan forward bars for SL/TP hit -----
function simulate(strategyName, signalFn, slMult, tpMult, refEmaFn) {
  const trades = [];
  let blockedUntil = -1; // bar index after which we can take a new trade (block while in a position)
  for (let i = 200; i < bars.length - 1; i++) {
    if (i < blockedUntil) continue;
    const t = ctTime(bars[i].time);
    if (!inTradingWindow(t)) continue;
    const sig = signalFn(i);
    if (sig === 0) continue;

    const entry = bars[i+1].open; // market order fills at next bar open
    const refEma = refEmaFn(i);
    const a = atr[i];
    const sl = sig === 1 ? refEma - slMult * a : refEma + slMult * a;
    const tp = sig === 1 ? entry + tpMult * a : entry - tpMult * a;
    const slDist = Math.abs(entry - sl);
    if (slDist < 5 || slDist > 30) continue;
    const units = Math.min(Math.round(100 / slDist), 5000);

    // Scan forward for exit
    let exitBar = -1, exitPx = NaN, exitReason = 'eod';
    for (let j = i+1; j < bars.length; j++) {
      const fb = bars[j];
      const fbTime = ctTime(fb.time);
      // Force close at 14:30 CT (market close rule)
      if (fbTime.hour > 14 || (fbTime.hour === 14 && fbTime.minute >= 30)) {
        exitBar = j; exitPx = fb.open; exitReason = 'eod_close';
        break;
      }
      if (sig === 1) {
        // long
        if (fb.low <= sl) { exitBar = j; exitPx = sl; exitReason = 'sl'; break; }
        if (fb.high >= tp) { exitBar = j; exitPx = tp; exitReason = 'tp'; break; }
      } else {
        if (fb.high >= sl) { exitBar = j; exitPx = sl; exitReason = 'sl'; break; }
        if (fb.low <= tp) { exitBar = j; exitPx = tp; exitReason = 'tp'; break; }
      }
    }
    if (exitBar < 0) {
      // ran out of data (still open)
      exitBar = bars.length - 1;
      exitPx = bars[bars.length - 1].close;
      exitReason = 'open_at_end';
    }
    const pnl = sig === 1 ? (exitPx - entry) * units : (entry - exitPx) * units;
    trades.push({
      strategy: strategyName,
      entryTime: ctTime(bars[i+1].time).dateStr + ' ' + ctTime(bars[i+1].time).timeStr,
      side: sig === 1 ? 'BUY' : 'SELL',
      units,
      entry: +entry.toFixed(2),
      sl: +sl.toFixed(2),
      tp: +tp.toFixed(2),
      exitTime: ctTime(bars[exitBar].time).dateStr + ' ' + ctTime(bars[exitBar].time).timeStr,
      exit: +exitPx.toFixed(2),
      reason: exitReason,
      pnl: +pnl.toFixed(2),
    });
    blockedUntil = exitBar + 1;
  }
  return trades;
}

const scalperTrades = simulate('EMA21 Scalper', signalScalper, 1.5, 2.0, (i) => ema21[i]);
const ema200Trades = simulate('EMA200 Touch', signal200, 2.0, 3.0, (i) => ema200[i]);

// ----- Strategy 3: ORB-15 -----
// Find the 8:30-8:44 CT range for each trading day, then look for first breakout in 8:45-10:30 CT.
function simulateORB() {
  const trades = [];
  // Group bars by date
  const byDate = {};
  for (let i = 0; i < bars.length; i++) {
    const t = ctTime(bars[i].time);
    if (!byDate[t.dateStr]) byDate[t.dateStr] = [];
    byDate[t.dateStr].push(i);
  }
  for (const date of Object.keys(byDate)) {
    const idxs = byDate[date];
    // Build OR from bars in [8:30, 8:45) CT
    let orHigh = -Infinity, orLow = Infinity;
    let orBars = [];
    for (const i of idxs) {
      const t = ctTime(bars[i].time);
      const min = t.hour * 60 + t.minute;
      if (min >= 8 * 60 + 30 && min < 8 * 60 + 45) {
        orHigh = Math.max(orHigh, bars[i].high);
        orLow = Math.min(orLow, bars[i].low);
        orBars.push(i);
      }
    }
    if (orBars.length === 0 || !isFinite(orHigh) || !isFinite(orLow)) continue;
    const rangeHeight = orHigh - orLow;

    // Find first bar in 8:45-10:30 CT that breaks the range
    let entryIdx = -1, side = 0;
    for (const i of idxs) {
      const t = ctTime(bars[i].time);
      const min = t.hour * 60 + t.minute;
      if (min < 8 * 60 + 45 || min > 10 * 60 + 30) continue;
      if (bars[i].close > orHigh) { entryIdx = i; side = 1; break; }
      if (bars[i].close < orLow)  { entryIdx = i; side = -1; break; }
    }
    if (entryIdx < 0) continue;

    const entry = bars[entryIdx].close;
    const sl = side === 1 ? orLow : orHigh;
    const tp = side === 1 ? entry + 1.5 * rangeHeight : entry - 1.5 * rangeHeight;
    const slDist = Math.abs(entry - sl);
    if (slDist < 5 || slDist > 30) continue;
    const units = Math.min(Math.round(100 / slDist), 5000);

    // Scan forward for exit
    let exitBar = -1, exitPx = NaN, exitReason = 'eod';
    for (let j = entryIdx + 1; j < bars.length; j++) {
      const fb = bars[j];
      const fbTime = ctTime(fb.time);
      if (fbTime.dateStr !== date) { exitBar = j; exitPx = fb.open; exitReason = 'day_end'; break; }
      if (fbTime.hour > 14 || (fbTime.hour === 14 && fbTime.minute >= 30)) {
        exitBar = j; exitPx = fb.open; exitReason = 'eod_close'; break;
      }
      if (side === 1) {
        if (fb.low <= sl) { exitBar = j; exitPx = sl; exitReason = 'sl'; break; }
        if (fb.high >= tp) { exitBar = j; exitPx = tp; exitReason = 'tp'; break; }
      } else {
        if (fb.high >= sl) { exitBar = j; exitPx = sl; exitReason = 'sl'; break; }
        if (fb.low <= tp) { exitBar = j; exitPx = tp; exitReason = 'tp'; break; }
      }
    }
    if (exitBar < 0) { exitBar = bars.length - 1; exitPx = bars[bars.length - 1].close; exitReason = 'open_at_end'; }
    const pnl = side === 1 ? (exitPx - entry) * units : (entry - exitPx) * units;
    trades.push({
      strategy: 'ORB-15',
      date,
      orHigh: +orHigh.toFixed(2), orLow: +orLow.toFixed(2), rangeHeight: +rangeHeight.toFixed(2),
      entryTime: ctTime(bars[entryIdx].time).timeStr,
      side: side === 1 ? 'BUY' : 'SELL',
      units, entry: +entry.toFixed(2), sl: +sl.toFixed(2), tp: +tp.toFixed(2),
      exitTime: ctTime(bars[exitBar].time).timeStr,
      exit: +exitPx.toFixed(2),
      reason: exitReason, pnl: +pnl.toFixed(2),
    });
  }
  return trades;
}

const orbTrades = simulateORB();

function reportTrades(name, trades) {
  console.log(`\n=== ${name} ===`);
  if (trades.length === 0) { console.log('No trades.'); return; }
  let gross = 0, wins = 0, losses = 0;
  const byDay = {};
  for (const t of trades) {
    gross += t.pnl;
    if (t.pnl > 0) wins++; else losses++;
    const d = t.entryTime.slice(0,10);
    byDay[d] = (byDay[d] || 0) + t.pnl;
    console.log(`${t.entryTime} ${t.side.padEnd(4)} u=${String(t.units).padStart(4)} entry=${t.entry} sl=${t.sl} tp=${t.tp} → ${t.exitTime} @ ${t.exit} (${t.reason}) pnl=${t.pnl >= 0 ? '+' : ''}${t.pnl}`);
  }
  console.log(`Total: ${trades.length} trades, ${wins}W / ${losses}L, WR ${(wins/trades.length*100).toFixed(1)}%, Gross P&L: $${gross.toFixed(2)}`);
  console.log('Per day:', byDay);
}

reportTrades('EMA Bounce Scalper v3 (R:R 1.3, time-filter)', scalperTrades);
reportTrades('EMA200 Touch (R:R 1.5, time-filter)', ema200Trades);

console.log('\n=== ORB-15 (current live strategy) ===');
if (orbTrades.length === 0) {
  console.log('No ORB trades in this data range (need bars covering 8:30-10:30 CT).');
} else {
  let orbGross = 0;
  for (const t of orbTrades) {
    orbGross += t.pnl;
    console.log(`${t.date} OR ${t.orLow}-${t.orHigh} (h=${t.rangeHeight}pt) | ${t.entryTime} ${t.side} u=${t.units} entry=${t.entry} sl=${t.sl} tp=${t.tp} → ${t.exitTime} @ ${t.exit} (${t.reason}) pnl=${t.pnl>=0?'+':''}${t.pnl}`);
  }
  console.log(`Total ORB: ${orbTrades.length} trades, gross $${orbGross.toFixed(2)}`);
}

const totalGross = [...scalperTrades, ...ema200Trades, ...orbTrades].reduce((s,t)=>s+t.pnl, 0);
console.log(`\nCOMBINED gross P&L (all 3 strategies): $${totalGross.toFixed(2)}`);
console.log(`Bar range: ${ctTime(bars[0].time).dateStr} ${ctTime(bars[0].time).timeStr} → ${ctTime(bars[bars.length-1].time).dateStr} ${ctTime(bars[bars.length-1].time).timeStr} (${bars.length} bars)`);
