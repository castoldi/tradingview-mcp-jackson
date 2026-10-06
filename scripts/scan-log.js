#!/usr/bin/env node
// Bot-run log: records what Claude did on each cron tick and how many tokens it used.
//
// Token counts come from this Claude Code session's own transcript
// (~/.claude/projects/<project-slug>/<session>.jsonl). The tick starts at the last user message
// containing the marker `[cron:<job>]` (every cron prompt starts with it). The logger adds up the
// usage of every API call after that point. The tool call that writes the row to the Trade Book db
// runs after this script, so each row slightly undercounts its own tick.
//
// Storage: journal/scans.jsonl (append-only, gitignored). The script prints the row as JSON so the
// cron can write it to the Trade Book's `runs` collection with ArtifactData.
//
// Usage:
//   node scripts/scan-log.js <job> <action> "what was done" [--price P] [--model M]
//     action: quiet | alert | advice | trade | skip | error
//   node scripts/scan-log.js today        totals for today (runs, tokens by job)

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'journal');
const LOG = join(DIR, 'scans.jsonl');
const TZ = 'America/Chicago';
const PROJ = join(homedir(), '.claude', 'projects', ROOT.replace(/[^A-Za-z0-9]/g, '-'));

const ctDate = d => d.toLocaleDateString('en-CA', { timeZone: TZ });
const ctTime = d => d.toLocaleTimeString('en-US', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const readLog = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

function transcript() {
  if (!existsSync(PROJ)) return null;
  const files = readdirSync(PROJ).filter(f => f.endsWith('.jsonl')).map(f => join(PROJ, f));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null;
}

function tickUsage(job) {
  const file = transcript();
  const zero = { start: null, calls: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, model: null, session: null };
  if (!file) return zero;
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const marker = `[cron:${job}]`;
  let startIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const e = lines[i];
    if (e.type === 'user' && JSON.stringify(e.message?.content ?? '').includes(marker)) { startIdx = i; break; }
  }
  if (startIdx < 0) return { ...zero, session: file.split(/[\\/]/).pop().replace('.jsonl', '') };
  const u = { ...zero, start: lines[startIdx].timestamp, session: lines[startIdx].sessionId };
  const seen = new Set(); // one API call is split across several transcript lines that repeat the same usage
  for (const e of lines.slice(startIdx + 1)) {
    if (e.type !== 'assistant' || !e.message?.usage || e.isSidechain) continue;
    const id = e.message.id || e.uuid;
    if (seen.has(id)) continue;
    seen.add(id);
    const m = e.message.usage;
    u.calls++;
    u.input += m.input_tokens || 0;
    u.output += m.output_tokens || 0;
    u.cache_read += m.cache_read_input_tokens || 0;
    u.cache_write += m.cache_creation_input_tokens || 0;
    u.model = e.message.model || u.model;
  }
  return u;
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

const args = process.argv.slice(2);
try {
  if (args[0] === 'today') {
    const day = ctDate(new Date());
    const rows = readLog().filter(r => r.date === day);
    const by = {};
    for (const r of rows) {
      const b = (by[r.job] ||= { runs: 0, alerts: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 });
      b.runs++; if (r.action !== 'quiet') b.alerts++;
      for (const k of ['input', 'output', 'cache_read', 'cache_write']) b[k] += r.tokens[k];
    }
    console.log(JSON.stringify({ date: day, runs: rows.length, by_job: by }, null, 2));
    process.exit(0);
  }

  const price = flag(args, '--price');
  const [job, action, ...rest] = args;
  if (!job || !action) { console.error('usage: scan-log.js <job> <action> "what was done" [--price P]'); process.exit(0); }
  const now = new Date();
  const u = tickUsage(job);
  const date = ctDate(now);
  const n = readLog().filter(r => r.date === date).length + 1;
  const row = {
    id: `R-${date.replace(/-/g, '')}-${String(n).padStart(4, '0')}`,
    date, time: ctTime(now), job, action,
    summary: rest.join(' ').trim(),
    price: price != null ? Number(price) : null,
    tokens: { input: u.input, output: u.output, cache_read: u.cache_read, cache_write: u.cache_write,
      total: u.input + u.output + u.cache_read + u.cache_write },
    calls: u.calls,
    secs: u.start ? Math.round((now - new Date(u.start)) / 1000) : null,
    model: u.model, session: u.session,
  };
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  appendFileSync(LOG, JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
} catch (e) {
  console.error('scan-log:', e.message);
}
process.exit(0);
