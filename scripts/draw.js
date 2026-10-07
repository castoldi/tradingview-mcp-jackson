#!/usr/bin/env node
// Chart drawing CLI over CDP, for cron ticks and for when the MCP server is down.
//
// Usage:
//   node scripts/draw.js list                                   id, type, price(s), label of every drawing
//   node scripts/draw.js rm <id> [id...]                        remove drawings (IDs are case-sensitive)
//   node scripts/draw.js hline <price> "<label>" [--color #hex] [--dashed]
//   node scripts/draw.js zone <lo> <hi> "<label>" [--color #hex] [--mins 120]
//   node scripts/draw.js long|short <entry> <sl> <tp> [--t0 <time>] [--tick 0.5] [--mins 105]   position tool; ticks = pts / tick; --t0 puts it at a past time
//   node scripts/draw.js text <price> "<label>" [--t0 <time>] [--color #hex]
//   node scripts/draw.js fib <legStartPrice> <legEndPrice> [--t0 <time>] [--t1 <time>] [--ext]
//        Fibonacci retracement of an impulse leg, labeled the standard way: 0 at the leg END, 1 at the leg START
//        (so for an up-leg low->high, 0.618 sits 61.8% of the way back down from the high). Levels 0 / .382 / .5 /
//        .618 (gold, labeled) / .786 / 1, plus 1.272 and 1.618 extensions. <time> is unix seconds, "HH:MM" (CT, today)
//        or "YYYY-MM-DD HH:MM" (CT). Defaults: t1 = now, t0 = 30 min before. --ext adds the extensions as targets.
// Prints JSON. Never throws into the caller: errors print and exit 0.

import * as d from '../src/core/drawing.js';
import { evaluate, KNOWN_PATHS } from '../src/connection.js';

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const now = () => Math.floor(Date.now() / 1000);
const print = o => console.log(JSON.stringify(o));

  const parseT = (x, dflt) => {
    if (x == null) return dflt;
    if (/^\d{9,}$/.test(x)) return Number(x);
    const m = x.match(/^(?:(\d{4})-(\d{2})-(\d{2}) )?(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error('bad time: ' + x);
    const nowD = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const y = m[1] ? +m[1] : nowD.getFullYear(), mo = m[2] ? +m[2] : nowD.getMonth() + 1, da = m[3] ? +m[3] : nowD.getDate();
    // hours to ADD to a Central Time wall clock to get UTC (5 in CDT, 6 in CST) for that calendar day
    const ctNoonHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(new Date(Date.UTC(y, mo - 1, da, 12))));
    const off = 12 - ctNoonHour;
    return Date.UTC(y, mo - 1, da, +m[4] + off, +m[5]) / 1000;
  };

try {
  const cmd = args.shift();
  if (cmd === 'list') {
    const { shapes } = await d.listDrawings();
    for (const s of shapes) {
      const p = await d.getProperties({ entity_id: s.id });
      const pr = p.properties || {};
      print({ id: s.id, type: s.name, prices: (p.points || []).map(x => +x.price.toFixed(2)), label: pr.text || '',
        ...(pr.stopLevel != null ? { stop_ticks: pr.stopLevel, profit_ticks: pr.profitLevel } : {}) });
    }
  } else if (cmd === 'rm') {
    for (const id of args) print({ id, removed: (await d.removeOne({ entity_id: id })).success });
  } else if (cmd === 'hline') {
    const color = flag('--color', '#455a64'), dashed = bool('--dashed');
    const [price, label = ''] = args;
    print(await d.drawShape({ shape: 'horizontal_line', point: { time: now(), price: +price }, text: label,
      overrides: { linecolor: color, linewidth: 2, linestyle: dashed ? 2 : 0, text: label, showLabel: true } }));
  } else if (cmd === 'zone') {
    const color = flag('--color', '#1d5f8a'), mins = +flag('--mins', 120);
    const [lo, hi, label = ''] = args;
    print(await d.drawShape({ shape: 'rectangle', point: { time: now(), price: +hi }, point2: { time: now() + mins * 60, price: +lo }, text: label,
      overrides: { color, backgroundColor: color + '22', text: label, showLabel: true } }));
  } else if (cmd === 'fib') {
    const ext = bool('--ext');
    const t0a = flag('--t0'), t1a = flag('--t1');
    const [from, to] = args.map(Number);
    const t1 = parseT(t1a, now()), t0 = parseT(t0a, t1 - 1800);
    const res = await evaluate(`(async function(){
      var api = ${KNOWN_PATHS.chartApi};
      var before = api.getAllShapes().map(function(s){ return s.id; });
      // first point = leg END (level 0), second point = leg START (level 1)
      await api.createMultipointShape([{time:${t1}, price:${to}},{time:${t0}, price:${from}}], {shape:'fib_retracement'});
      await new Promise(function(r){ setTimeout(r, 300); });
      var added = api.getAllShapes().filter(function(s){ return before.indexOf(s.id) < 0; });
      if (!added.length) return { error: 'fib not created' };
      var s = api.getShapeById(added[0].id);
      var vis = ${ext};
      s.setProperties({ coeffsAsPercents:false, showPrices:true, fillBackground:false, extendLines:true, extendLinesLeft:false,
        level1:[0,'#808080',true,''], level2:[0.236,'#cc2828',false,''], level3:[0.382,'#95cc28',true,''], level4:[0.5,'#28cc28',true,''],
        level5:[0.618,'#e8a317',true,'GOLD'], level6:[0.786,'#2895cc',true,''], level7:[1,'#808080',true,''],
        level8:[1.272,'#9b28cc',vis,''], level9:[1.618,'#2828cc',vis,''], level10:[2.618,'#cc2828',false,''], level11:[4.236,'#cc2828',false,''], level12:[1.414,'#cc2828',false,''] });
      return { id: added[0].id };
    })()`, { awaitPromise: true });
    print({ ...res, leg: { from, to, t0, t1 }, up_leg: to > from, level_0618: +(to - 0.618 * (to - from)).toFixed(2), level_05: +(to - 0.5 * (to - from)).toFixed(2), level_0382: +(to - 0.382 * (to - from)).toFixed(2) });
  } else if (cmd === 'text') {
    const t0a = flag('--t0'), color = flag('--color', '#17202b');
    const [price, label = ''] = args;
    print(await d.drawShape({ shape: 'text', point: { time: parseT(t0a, now()), price: +price }, text: label,
      overrides: { color, textColor: color, fontsize: 12, bold: true } }));
  } else if (cmd === 'long' || cmd === 'short') {
    const tick = +flag('--tick', 0.5), mins = +flag('--mins', 105), t0a = flag('--t0');
    const [entry, sl, tp] = args.map(Number);
    const t0 = parseT(t0a, now());
    print(await d.drawShape({ shape: cmd === 'long' ? 'long_position' : 'short_position',
      point: { time: t0, price: entry }, point2: { time: t0 + mins * 60, price: entry },
      overrides: { stopLevel: Math.round(Math.abs(entry - sl) / tick), profitLevel: Math.round(Math.abs(tp - entry) / tick) } }));
  } else {
    console.error('usage: draw.js list | rm <id...> | hline <price> "<label>" | zone <lo> <hi> "<label>" | long|short <entry> <sl> <tp>');
  }
} catch (e) {
  console.error('draw:', e.message);
}
process.exit(0);
