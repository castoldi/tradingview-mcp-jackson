#!/usr/bin/env node
// Chart drawing CLI over CDP, for cron ticks and for when the MCP server is down.
//
// Usage:
//   node scripts/draw.js list                                   id, type, price(s), label of every drawing
//   node scripts/draw.js rm <id> [id...]                        remove drawings (IDs are case-sensitive)
//   node scripts/draw.js hline <price> "<label>" [--color #hex] [--dashed]
//   node scripts/draw.js zone <lo> <hi> "<label>" [--color #hex] [--mins 120]
//   node scripts/draw.js long|short <entry> <sl> <tp> [--tick 0.5] [--mins 105]   position tool; ticks = pts / tick
// Prints JSON. Never throws into the caller: errors print and exit 0.

import * as d from '../src/core/drawing.js';

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const now = () => Math.floor(Date.now() / 1000);
const print = o => console.log(JSON.stringify(o));

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
  } else if (cmd === 'long' || cmd === 'short') {
    const tick = +flag('--tick', 0.5), mins = +flag('--mins', 105);
    const [entry, sl, tp] = args.map(Number);
    print(await d.drawShape({ shape: cmd === 'long' ? 'long_position' : 'short_position',
      point: { time: now(), price: entry }, point2: { time: now() + mins * 60, price: entry },
      overrides: { stopLevel: Math.round(Math.abs(entry - sl) / tick), profitLevel: Math.round(Math.abs(tp - entry) / tick) } }));
  } else {
    console.error('usage: draw.js list | rm <id...> | hline <price> "<label>" | zone <lo> <hi> "<label>" | long|short <entry> <sl> <tp>');
  }
} catch (e) {
  console.error('draw:', e.message);
}
process.exit(0);
