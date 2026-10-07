#!/usr/bin/env node
// TradingView price alerts for entry plans, through the page's own alerts REST API (the logged-in session), over CDP.
// (src/core/alerts.js can only create by clicking the UI and cannot delete one alert; this does list / delete / create by id.)
//
// Rule (user, 2026-10-06): whenever the entry points are redone, DELETE the old NNQ alerts and CREATE new ones for the new plan.
//   node scripts/alerts.js reset --levels "31540:B entry (limit buy, SL 31522, TP 31605),31522:B stop"   one step: delete every NNQ alert, then create these
//
// Usage:
//   node scripts/alerts.js list [--all]                  alerts for the chart's symbol (--all = every symbol)
//   node scripts/alerts.js rm <alert_id> [alert_id...]   delete specific alerts
//   node scripts/alerts.js rm --all-here                 delete every alert on the chart's symbol
//   node scripts/alerts.js set <price> "<message>" [--hours 24]   create a "crossing" price alert on the chart's symbol (popup + mobile push)
//   node scripts/alerts.js reset --levels "<price>:<message>,<price>:<message>" [--hours 24]
// Prints JSON. Exit 0 always; check `ok`.

import { evaluate, KNOWN_PATHS } from '../src/connection.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const print = o => { console.log(JSON.stringify(o)); process.exit(0); };
const cmd = (args.shift() || '').toLowerCase();

const sym = async () => (await evaluate(`${KNOWN_PATHS.chartApi}.symbol()`));
const api = (path, body) => evaluate(`(async function(){
  var opt = { credentials: 'include' };
  ${body ? `opt.method = 'POST'; opt.headers = { 'Content-Type': 'text/plain;charset=UTF-8' }; opt.body = ${JSON.stringify(JSON.stringify(body))};` : ''}
  var res = await fetch('https://pricealerts.tradingview.com/${path}', opt);
  var t = await res.text(); try { return JSON.parse(t); } catch (e) { return { s: 'error', status: res.status, errmsg: t.slice(0, 300) }; } })()`, { awaitPromise: true });
const symOf = a => { try { return JSON.parse(String(a.symbol).replace(/^=/, '')).symbol; } catch { return a.symbol; } };
const lookup = async all => {
  const r = await api('list_alerts');
  if (r.s !== 'ok') throw new Error('list_alerts: ' + (r.errmsg || r.s));
  const here = await sym();
  return { raw: r.r, here, rows: r.r.filter(a => all || symOf(a) === here) };
};
const brief = a => ({ id: a.alert_id, symbol: symOf(a), price: a.condition?.series?.[1]?.value, active: a.active, fired: a.last_fire_time || null, message: (a.message || '').slice(0, 90) });

try {
  if (cmd === 'list') {
    const { rows } = await lookup(bool('--all'));
    print({ ok: true, count: rows.length, alerts: rows.map(brief) });
  } else if (cmd === 'rm') {
    const all = bool('--all-here');
    const { rows } = await lookup(false);
    const ids = all ? rows.map(a => a.alert_id) : args.map(Number);
    if (!ids.length) print({ ok: true, deleted: [], note: 'nothing to delete' });
    const r = await api('delete_alerts', { payload: { alert_ids: ids } });
    const after = (await lookup(false)).rows.map(a => a.alert_id);
    print({ ok: r.s === 'ok' && ids.every(i => !after.includes(i)), requested: ids, response: r.s, still_present: ids.filter(i => after.includes(i)), error: r.errmsg });
  } else if (cmd === 'set' || cmd === 'reset') {
    const hours = Number(flag('--hours', 24));
    let levels;
    if (cmd === 'set') { const [price, ...m] = args; levels = [[Number(price), m.join(' ')]]; }
    else levels = String(flag('--levels', '')).split(',').filter(Boolean).map(x => { const i = x.indexOf(':'); return [Number(x.slice(0, i)), x.slice(i + 1).trim()]; });
    if (!levels.length || levels.some(([p]) => !Number.isFinite(p))) print({ ok: false, error: 'usage: set <price> "<message>" | reset --levels "<price>:<message>,..."' });
    let deleted = [];
    const { raw, here } = await lookup(false);
    if (cmd === 'reset') {
      const ids = raw.filter(a => symOf(a) === here).map(a => a.alert_id);
      if (ids.length) { const d = await api('delete_alerts', { payload: { alert_ids: ids } }); if (d.s !== 'ok') print({ ok: false, error: 'delete failed: ' + (d.errmsg || d.s) }); deleted = ids; }
    }
    // Template: reuse the exact field layout of an existing alert if there is one, else build it by hand.
    const tpl = raw.find(a => symOf(a) === here) || raw[0];
    const proSym = tpl ? tpl.symbol : '=' + JSON.stringify({ symbol: here, adjustment: 'splits', session: 'regular', 'currency-id': 'USD', 'settlement-as-close': false });
    const expiry = new Date(Date.now() + hours * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');
    const created = [];
    for (const [price, message] of levels) {
      const cond = { type: 'cross', frequency: 'on_first_fire', series: [{ type: 'barset' }, { type: 'value', value: price }], cross_interval: true, resolution: '1' };
      // Exactly these fields: adding `conditions`, `expiration_policy`, `kinds` or a top-level `cross_interval` makes create_alert answer invalid_request.
      const payload = { symbol: proSym, resolution: '1', condition: cond, expiration: expiry, auto_deactivate: true,
        email: false, sms_over_email: false, mobile_push: true, message, sound_file: 'alert/fired', sound_duration: 0, popup: true, web_hook: null, name: null, active: true, type: 'price' };
      const r = await api('create_alert', { payload });
      created.push({ price, message: message.slice(0, 70), ok: r.s === 'ok', id: r.r?.alert_id, error: r.s === 'ok' ? undefined : (r.errmsg || r.s) + ' ' + JSON.stringify(r.err || '') });
    }
    await new Promise(r => setTimeout(r, 4000)); // a new alert reads active:false for a second or two before it arms
    const now = (await lookup(false)).rows.map(brief);
    print({ ok: created.every(c => c.ok) && now.every(a => a.active), deleted, created, all_active: now.every(a => a.active), alerts_now: now });
  } else {
    print({ ok: false, error: 'usage: alerts.js list | rm <id...> | rm --all-here | set <price> "<message>" | reset --levels "<price>:<message>,..."' });
  }
} catch (e) {
  print({ ok: false, error: e.message });
}
