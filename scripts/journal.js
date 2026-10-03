#!/usr/bin/env node
// Trading journal — append-only log of trades, reasoning, advice and events.
//
// Storage: journal/entries.jsonl (one JSON object per line, never rewritten)
//          journal/days/YYYY-MM-DD.md (human-readable day view, regenerated on every write)
// Times are recorded in UTC and displayed in Central Time (America/Chicago).
//
// Usage:
//   node scripts/journal.js open <BUY|SELL> <symbol> <entry> <units> <sl> <tp> [--strategy S] [--source bot|user|claude] [--mult N] "reasoning"
//   node scripts/journal.js close <tradeId> <exitPrice> ["why it closed"]
//   node scripts/journal.js advice <symbol> <LONG|SHORT|WAIT|NO> "verdict + reasoning" [--entry P] [--sl P] [--tp P]
//   node scripts/journal.js outcome <adviceId> <right|wrong|mixed|untested> "what actually happened"
//   node scripts/journal.js <analysis|event|decision|skip|lesson|note> "text" [--symbol X]
//   node scripts/journal.js show [YYYY-MM-DD]      print the day view (default today)
//   node scripts/journal.js open-trades             list trades with no exit
//   node scripts/journal.js stats [--since YYYY-MM-DD] [--strategy S]
//   node scripts/journal.js render [YYYY-MM-DD|all] regenerate day markdown
//
// Common flags: --symbol X  --tags a,b  --source user|claude|bot (default claude)
// Never throws into the trading loop: write errors print to stderr and exit 0.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'journal');
const LOG = join(DIR, 'entries.jsonl');
const DAYS = join(DIR, 'days');
const TZ = 'America/Chicago';

// Dollars per 1 point per 1 unit. Symbols not listed get no $ P&L unless --mult is passed.
const SYMBOL_MULT = { 'OANDA:SPX500USD': 1 };

const PREFIX = {
  trade: 'T', exit: 'X', advice: 'A', outcome: 'O', analysis: 'N',
  event: 'E', decision: 'D', skip: 'S', lesson: 'L', note: 'M',
};
const ICON = {
  trade: '🟢', exit: '🏁', advice: '💡', outcome: '🎯', analysis: '🔍',
  event: '📰', decision: '🧭', skip: '⏭️', lesson: '📚', note: '📝',
};

// ── helpers ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else pos.push(a);
  }
  return { pos, flags };
}

function ctParts(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function num(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) die(`${name} must be a number (got "${v}")`);
  return n;
}

function die(msg) {
  console.error(`journal: ${msg}`);
  process.exit(1);
}

const round = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const fmt$ = n => (n == null ? '—' : `${n < 0 ? '-' : '+'}$${Math.abs(n).toFixed(2)}`);
const fmtPts = n => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)} pts`);

function readAll() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch { console.error(`journal: skipping bad line ${i + 1}`); return null; }
  }).filter(Boolean);
}

function nextId(kind, date, entries) {
  const stem = `${PREFIX[kind]}-${date.replace(/-/g, '')}-`;
  const n = entries.filter(e => e.id.startsWith(stem)).length + 1;
  return stem + n;
}

function append(kind, fields, flags) {
  const entries = readAll();
  const now = new Date();
  const { date, time } = ctParts(now);
  const entry = {
    id: nextId(kind, date, entries),
    ts: now.toISOString(),
    date, time, kind,
    source: flags.source || 'claude',
    ...(flags.symbol ? { symbol: flags.symbol } : {}),
    ...(flags.tags ? { tags: String(flags.tags).split(',').map(s => s.trim()).filter(Boolean) } : {}),
    ...fields,
  };
  try {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(LOG, JSON.stringify(entry) + '\n');
    renderDay(date, [...entries, entry]);
  } catch (err) {
    console.error(`journal: write failed: ${err.message}`);
    process.exit(0); // soft fail — never break the trading loop
  }
  return entry;
}

// Fold trade + exit entries into trade records.
function trades(entries) {
  const map = new Map();
  for (const e of entries) {
    if (e.kind === 'trade') map.set(e.id, { ...e, exit: null });
    if (e.kind === 'exit' && map.has(e.ref)) map.get(e.ref).exit = e;
  }
  return [...map.values()];
}

function adviceWithOutcomes(entries) {
  const map = new Map();
  for (const e of entries) {
    if (e.kind === 'advice') map.set(e.id, { ...e, outcome: null });
    if (e.kind === 'outcome' && map.has(e.ref)) map.get(e.ref).outcome = e;
  }
  return [...map.values()];
}

// ── rendering ──────────────────────────────────────────────────────────────

function entryLine(e) {
  const d = e.data || {};
  const who = e.source !== 'claude' ? ` _(${e.source})_` : '';
  const sym = e.symbol ? ` **${e.symbol}**` : '';
  let head;
  switch (e.kind) {
    case 'trade':
      head = `**${d.side}** ${d.units} @ ${d.entry} · SL ${d.sl} · TP ${d.tp} · risk ${d.riskPts} pts${d.strategy ? ` · _${d.strategy}_` : ''}`;
      break;
    case 'exit':
      head = `Closed ${e.ref} @ ${d.exit} → ${fmtPts(d.pts)} · ${d.r != null ? `${d.r}R` : ''} · ${fmt$(d.pnl)}`;
      break;
    case 'advice':
      head = `**${d.verdict}**${[d.entry && `entry ${d.entry}`, d.sl && `SL ${d.sl}`, d.tp && `TP ${d.tp}`].filter(Boolean).map(s => ` · ${s}`).join('')}`;
      break;
    case 'outcome':
      head = `${e.ref} was **${d.result}**`;
      break;
    default:
      head = '';
  }
  const body = e.text ? (head ? ` — ${e.text}` : e.text) : '';
  return `- \`${e.time}\` ${ICON[e.kind] || '•'} \`${e.id}\`${sym}${who} ${head}${body}`;
}

function renderDay(date, entries = readAll()) {
  const day = entries.filter(e => e.date === date);
  const allTrades = trades(entries);
  const dayTrades = allTrades.filter(t => t.date === date);
  const closedToday = allTrades.filter(t => t.exit && t.exit.date === date);
  const pnl = closedToday.reduce((s, t) => s + (t.exit.data.pnl ?? 0), 0);
  const pts = closedToday.reduce((s, t) => s + t.exit.data.pts, 0);
  const wins = closedToday.filter(t => t.exit.data.pts > 0).length;
  const advice = adviceWithOutcomes(entries).filter(a => a.date === date);

  const out = [`# Trading Journal — ${date}`, ''];
  out.push(`**Closed:** ${closedToday.length} (${wins}W / ${closedToday.length - wins}L) · **Points:** ${fmtPts(pts)} · **P&L:** ${fmt$(pnl)} · **Still open:** ${allTrades.filter(t => !t.exit).length}`, '');

  if (dayTrades.length) {
    out.push('## Trades', '', '| ID | Time | Symbol | Side | Units | Entry | SL | TP | Exit | Pts | R | P&L | Strategy |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const t of dayTrades) {
      const d = t.data, x = t.exit?.data;
      out.push(`| ${t.id} | ${t.time} | ${t.symbol} | ${d.side} | ${d.units} | ${d.entry} | ${d.sl} | ${d.tp} | ${x ? x.exit : 'open'} | ${x ? round(x.pts) : ''} | ${x?.r ?? ''} | ${x ? fmt$(x.pnl) : ''} | ${d.strategy || ''} |`);
    }
    out.push('');
  }

  if (advice.length) {
    out.push('## Advice scorecard', '');
    for (const a of advice) {
      out.push(`- \`${a.id}\` ${a.symbol || ''} **${a.data.verdict}** → ${a.outcome ? `**${a.outcome.data.result}** — ${a.outcome.text}` : '_no outcome logged yet_'}`);
    }
    out.push('');
  }

  out.push('## Timeline', '');
  out.push(...(day.length ? day.map(entryLine) : ['_No entries._']), '');

  const lessons = day.filter(e => e.kind === 'lesson');
  if (lessons.length) out.push('## Lessons', '', ...lessons.map(l => `- ${l.text}`), '');

  mkdirSync(DAYS, { recursive: true });
  const file = join(DAYS, `${date}.md`);
  writeFileSync(file, out.join('\n'));
  return file;
}

// ── commands ───────────────────────────────────────────────────────────────

const { pos, flags } = parseArgs(process.argv.slice(2));
const cmd = pos.shift();

switch (cmd) {
  case 'open': {
    const [sideArg, symbol, entryA, unitsA, slA, tpA, ...rest] = pos;
    if (!tpA) die('usage: open <BUY|SELL> <symbol> <entry> <units> <sl> <tp> "reasoning"');
    const side = sideArg.toUpperCase();
    if (side !== 'BUY' && side !== 'SELL') die(`side must be BUY or SELL (got ${sideArg})`);
    const entry = num(entryA, 'entry'), units = num(unitsA, 'units'), sl = num(slA, 'sl'), tp = num(tpA, 'tp');
    const mult = flags.mult !== undefined ? num(flags.mult, '--mult') : SYMBOL_MULT[symbol] ?? null;
    const riskPts = round(Math.abs(entry - sl));
    const e = append('trade', {
      symbol,
      text: rest.join(' ') || undefined,
      data: {
        side, entry, units, sl, tp, mult, riskPts,
        rewardPts: round(Math.abs(tp - entry)),
        rr: riskPts ? round(Math.abs(tp - entry) / riskPts) : null,
        riskUsd: mult != null ? round(riskPts * units * mult) : null,
        ...(flags.strategy ? { strategy: flags.strategy } : {}),
      },
    }, flags);
    console.log(e.id);
    break;
  }

  case 'close': {
    const [ref, exitA, ...rest] = pos;
    if (!exitA) die('usage: close <tradeId> <exitPrice> ["reason"]');
    const t = trades(readAll()).find(x => x.id === ref);
    if (!t) die(`no trade ${ref}`);
    if (t.exit) die(`${ref} already closed by ${t.exit.id}`);
    const exit = num(exitA, 'exit');
    const d = t.data;
    const pts = round((d.side === 'BUY' ? exit - d.entry : d.entry - exit));
    const e = append('exit', {
      ref, symbol: t.symbol, text: rest.join(' ') || undefined,
      data: {
        exit, pts,
        r: d.riskPts ? round(pts / d.riskPts) : null,
        pnl: d.mult != null ? round(pts * d.units * d.mult) : null,
        heldMin: Math.round((Date.now() - Date.parse(t.ts)) / 60000),
      },
    }, flags);
    console.log(`${e.id} ${fmtPts(pts)} ${fmt$(e.data.pnl)}`);
    break;
  }

  case 'advice': {
    const [symbol, verdictA, ...rest] = pos;
    if (!verdictA) die('usage: advice <symbol> <LONG|SHORT|WAIT|NO> "reasoning"');
    const data = { verdict: verdictA.toUpperCase() };
    for (const k of ['entry', 'sl', 'tp']) if (flags[k] !== undefined) data[k] = num(flags[k], `--${k}`);
    const e = append('advice', { symbol, text: rest.join(' ') || undefined, data }, flags);
    console.log(e.id);
    break;
  }

  case 'outcome': {
    const [ref, result, ...rest] = pos;
    const allowed = ['right', 'wrong', 'mixed', 'untested'];
    if (!allowed.includes(result)) die(`usage: outcome <adviceId> <${allowed.join('|')}> "what happened"`);
    const a = readAll().find(x => x.id === ref && x.kind === 'advice');
    if (!a) die(`no advice ${ref}`);
    const e = append('outcome', { ref, symbol: a.symbol, text: rest.join(' ') || undefined, data: { result } }, flags);
    console.log(e.id);
    break;
  }

  case 'analysis': case 'event': case 'decision': case 'skip': case 'lesson': case 'note': {
    const text = pos.join(' ');
    if (!text) die(`usage: ${cmd} "text" [--symbol X]`);
    console.log(append(cmd, { text }, flags).id);
    break;
  }

  case 'show': {
    const date = pos[0] || ctParts().date;
    console.log(readFileSync(renderDay(date), 'utf8'));
    break;
  }

  case 'open-trades': {
    const open = trades(readAll()).filter(t => !t.exit);
    if (!open.length) console.log('No open trades.');
    for (const t of open) console.log(`${t.id}  ${t.date} ${t.time}  ${t.symbol}  ${t.data.side} ${t.data.units} @ ${t.data.entry}  SL ${t.data.sl}  TP ${t.data.tp}  ${t.data.strategy || ''}`);
    break;
  }

  case 'stats': {
    const entries = readAll().filter(e => !flags.since || e.date >= flags.since);
    let closed = trades(entries).filter(t => t.exit);
    if (flags.strategy) closed = closed.filter(t => (t.data.strategy || '').toLowerCase().includes(String(flags.strategy).toLowerCase()));
    const summarize = list => {
      const wins = list.filter(t => t.exit.data.pts > 0);
      const rs = list.map(t => t.exit.data.r).filter(r => r != null);
      const gw = wins.reduce((s, t) => s + (t.exit.data.pnl ?? 0), 0);
      const gl = list.filter(t => t.exit.data.pts <= 0).reduce((s, t) => s + (t.exit.data.pnl ?? 0), 0);
      return {
        trades: list.length,
        winRate: list.length ? `${Math.round((wins.length / list.length) * 100)}%` : '—',
        pts: round(list.reduce((s, t) => s + t.exit.data.pts, 0)),
        pnl: round(list.reduce((s, t) => s + (t.exit.data.pnl ?? 0), 0)),
        avgR: rs.length ? round(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
        profitFactor: gl ? round(gw / -gl) : null,
      };
    };
    const byStrategy = {};
    for (const t of closed) (byStrategy[t.data.strategy || '(none)'] ??= []).push(t);
    const advice = adviceWithOutcomes(entries);
    const tally = r => advice.filter(a => a.outcome?.data.result === r).length;
    console.log(JSON.stringify({
      since: flags.since || 'all',
      overall: summarize(closed),
      byStrategy: Object.fromEntries(Object.entries(byStrategy).map(([k, v]) => [k, summarize(v)])),
      openTrades: trades(entries).filter(t => !t.exit).length,
      advice: { given: advice.length, right: tally('right'), wrong: tally('wrong'), mixed: tally('mixed'), untested: tally('untested'), pending: advice.filter(a => !a.outcome).length },
      lessons: entries.filter(e => e.kind === 'lesson').length,
    }, null, 2));
    break;
  }

  case 'render': {
    const entries = readAll();
    const dates = pos[0] === 'all' ? [...new Set(entries.map(e => e.date))] : [pos[0] || ctParts().date];
    for (const d of dates) console.log(renderDay(d, entries));
    break;
  }

  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}
