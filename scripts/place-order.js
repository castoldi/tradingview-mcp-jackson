#!/usr/bin/env node
// Broker order placement (NinjaTrader / connected broker) through TradingView's order panel, over CDP.
//
// Safer than place-trade.js for real broker accounts:
//   - refuses unless the active account name equals --account (default DEMO8197451, the SIM account)
//   - fills inputs by position (qty, TP price, SL price), turns TP and SL on, then reads every value back
//   - clicks only if the submit button reads "<Side> <qty> <symbol> MARKET"
//   - waits, then reports the account's open positions
//
// Usage: node scripts/place-order.js <BUY|SELL> <qty> <sl> <tp> [--account DEMO8197451] [--dry]
//        node scripts/place-order.js POSITIONS            list open positions (read-only)
//        node scripts/place-order.js CLOSE [NNQ] [--dry]  flatten that position at market
// Prints JSON. Exit 0 always; check `ok`.

import { evaluate } from '../src/connection.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const dry = args.includes('--dry'); if (dry) args.splice(args.indexOf('--dry'), 1);
const account = flag('--account', 'DEMO8197451');
const [sideArg, qtyArg, slArg, tpArg] = args;
const side = (sideArg || '').toLowerCase();
const qty = Number(qtyArg), sl = Number(slArg), tp = Number(tpArg);
const print = o => { console.log(JSON.stringify(o)); process.exit(0); };

// `place-order.js CLOSE [symbolPart] [--dry]`: flatten the position via the row's Close button
// (TradingView cancels that position's bracket orders with it).
if (side === 'close' || side === 'positions') {
  const sym = side === 'close' ? (qtyArg || 'NNQ') : '';
  const cjs = `(async () => {
    const P = ${JSON.stringify({ account, sym, dry: dry || side === 'positions' })};
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const t = s => (s || '').replace(/\\s+/g, ' ').trim();
    const acct = t(document.querySelector('[class*="accountName-"]')?.textContent);
    if (acct !== P.account) return { ok: false, error: 'active account is "' + acct + '", expected ' + P.account };
    const am = () => document.querySelector('[class*="accountManager"]');
    const tab = Array.from(am().querySelectorAll('button,[role="tab"],div,span')).find(e => /^Positions\\s*\\d*$/.test(t(e.textContent)) && e.children.length < 3);
    if (tab) { tab.click(); await sleep(600); }
    const rows = Array.from(am().querySelectorAll('tr')).filter(tr => tr.querySelector('[data-name="close-settings-cell-button"]'));
    const list = rows.map(r => t(r.innerText));
    if (P.dry) return { ok: true, account: acct, positions: list };
    const row = rows.find(r => r.innerText.includes(P.sym));
    if (!row) return { ok: true, account: acct, closed: false, note: 'no open position matching ' + P.sym, positions: list };
    row.querySelector('[data-name="close-settings-cell-button"]').click();
    await sleep(1000);
    const confirm = Array.from(document.querySelectorAll('button')).find(b => /^(Close position|Close|Yes|OK|Confirm)$/i.test(t(b.textContent)) && !b.closest('tr'));
    if (confirm) { confirm.click(); await sleep(1500); }
    const left = Array.from(am().querySelectorAll('tr')).filter(tr => tr.querySelector('[data-name="close-settings-cell-button"]')).map(r => t(r.innerText));
    return { ok: true, account: acct, closed: !left.some(x => x.includes(P.sym)), confirm_clicked: !!confirm, closed_row: t(row.innerText), positions: left };
  })()`;
  try { print(await evaluate(cjs, { awaitPromise: true })); } catch (e) { print({ ok: false, error: e.message }); }
}

if (!['buy', 'sell'].includes(side) || !(qty > 0) || !Number.isFinite(sl) || !Number.isFinite(tp))
  print({ ok: false, error: 'usage: place-order.js <BUY|SELL> <qty> <sl> <tp> [--account ID] [--dry]' });
if (side === 'buy' ? !(sl < tp) : !(sl > tp)) print({ ok: false, error: `SL/TP on the wrong side for ${side}` });

const js = `(async () => {
  const P = ${JSON.stringify({ side, qty, sl, tp, account, dry })};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const t = s => (s || '').replace(/\\s+/g, ' ').trim();
  const acct = t(document.querySelector('[class*="accountName-"]')?.textContent);
  if (acct !== P.account) return { ok: false, error: 'active account is "' + acct + '", expected ' + P.account };
  const pp = () => document.querySelector('[data-name="order-panel"]'); // the panel re-renders after clicks
  if (!pp()) return { ok: false, error: 'order panel not open' };

  pp().querySelector('[data-name="side-control-' + P.side + '"]')?.click();
  await sleep(150);
  const market = Array.from(pp().querySelectorAll('button, [role="tab"]')).find(b => t(b.textContent) === 'Market');
  if (!market) return { ok: false, error: 'Market tab not found' };
  market.click(); await sleep(200);
  for (const cb of pp().querySelectorAll('input[type="checkbox"]')) if (!cb.checked) { cb.click(); await sleep(80); }

  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const txt = Array.from(pp().querySelectorAll('input')).filter(i => i.type === 'text'); // the type attribute is often absent
  if (txt.length < 3) return { ok: false, error: 'expected qty/TP/SL inputs, found ' + txt.length };
  const [qIn, tpIn, slIn] = txt;
  set(qIn, P.qty); await sleep(150);
  set(tpIn, P.tp); await sleep(150);
  set(slIn, P.sl); await sleep(250);

  const num = s => Number(String(s).replace(/,/g, ''));
  const back = { qty: num(qIn.value), tp: num(tpIn.value), sl: num(slIn.value),
    checks: Array.from(pp().querySelectorAll('input[type="checkbox"]')).map(c => c.checked) };
  if (back.qty !== P.qty || Math.abs(back.tp - P.tp) > 0.01 || Math.abs(back.sl - P.sl) > 0.01 || back.checks.includes(false))
    return { ok: false, error: 'inputs did not take', back };

  const btn = pp().querySelector('[data-name="place-and-modify-button"]');
  const label = t(btn?.innerText);
  const want = new RegExp('^' + (P.side === 'buy' ? 'Buy' : 'Sell') + ' ' + P.qty + ' \\\\S+ MARKET$', 'i');
  if (!want.test(label)) return { ok: false, error: 'submit button reads "' + label + '"', back };
  if (P.dry) return { ok: true, dry: true, account: acct, label, back };
  btn.click();
  await sleep(1500);
  const confirm = Array.from(document.querySelectorAll('button')).find(b => /^(Confirm|Place order|OK)$/i.test(t(b.textContent)));
  if (confirm) { confirm.click(); await sleep(1500); }
  const am = document.querySelector('[class*="accountManager"]');
  return { ok: true, account: acct, label, back, confirm_clicked: !!confirm, account_panel: t(am?.innerText).slice(0, 400) };
})()`;

try {
  print(await evaluate(js, { awaitPromise: true }));
} catch (e) {
  print({ ok: false, error: e.message });
}
