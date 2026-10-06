#!/usr/bin/env node
// Broker order entry (NinjaTrader SIM / connected broker) through TradingView's order panel, over CDP.
//
// Safer than place-trade.js for broker accounts:
//   - refuses unless the active account name equals --account (default DEMO8197451, the SIM account)
//   - fills inputs by position, turns TP and SL on, then reads every value back before clicking
//   - clicks only if the submit button reads exactly "<Side> <qty> <symbol> MARKET" (or "... @ <price> LIMIT")
//   - refuses an order whose SL risk is over --max-risk pts, or whose net R:R is under --min-r (fees included)
//
// Usage:
//   node scripts/place-order.js <BUY|SELL> <qty> <sl> <tp> [--dry]                 market entry + SL/TP brackets
//   node scripts/place-order.js LIMIT <BUY|SELL> <qty> <price> <sl> <tp> [--dry]   resting limit entry + SL/TP brackets
//                                                                                    (refused if marketable: it must rest >= 2 pts away from the quote)
//   node scripts/place-order.js POSITIONS        open positions (read-only)
//   node scripts/place-order.js ORDERS           every row of the Orders tab (read-only)
//   node scripts/place-order.js CANCEL [NNQ]     cancel working ENTRY limit orders only (never the TP/SL brackets of a position)
//   node scripts/place-order.js CLOSE [NNQ]      flatten the position at market (also cancels its brackets)
//   node scripts/place-order.js BALANCE          account balance and equity (read-only)
// Flags: --account ID  --dry  --max-risk 30  --min-r 1.5  --fee-pts 14.8 (SIM round trip is ~$2.96 = 14.8 pts per NNQ contract; LIVE ~9.4)
// Prints JSON. Exit 0 always; check `ok`.

import { evaluate } from '../src/connection.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const dry = bool('--dry');
const account = flag('--account', 'DEMO8197451');
const maxRisk = Number(flag('--max-risk', 30));
const minR = Number(flag('--min-r', 1.5));
const feePts = Number(flag('--fee-pts', 14.8));
const cmd = (args.shift() || '').toLowerCase();
const print = o => { console.log(JSON.stringify(o)); process.exit(0); };
const run = async js => { try { print(await evaluate(js, { awaitPromise: true })); } catch (e) { print({ ok: false, error: e.message }); } };

// Shared in-page helpers.
const PRELUDE = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const t = s => (s || '').replace(/\\s+/g, ' ').trim();
  const num = s => Number(String(s).replace(/,/g, ''));
  const P = ${JSON.stringify({ account })};
  const acct = t(document.querySelector('[class*="accountName-"]')?.textContent);
  if (acct !== P.account) return { ok: false, error: 'active account is "' + acct + '", expected ' + P.account };
  const am = () => document.querySelector('[class*="accountManager"]');
  const pp = () => document.querySelector('[data-name="order-panel"]'); // the panel re-renders after clicks
  const openTab = async id => { const b = am().querySelector('#' + id); if (b) { b.click(); await sleep(700); } };
  const tableRows = () => Array.from(am().querySelectorAll('tr')).filter(tr => tr.querySelector('[data-name="close-settings-cell-button"]'));
  const confirmDialog = async () => {
    const c = Array.from(document.querySelectorAll('button')).find(b => /^(Close position|Cancel order|Yes|OK|Confirm)$/i.test(t(b.textContent)) && !b.closest('tr'));
    if (c) { c.click(); await sleep(1200); }
    return !!c;
  };
`;

if (cmd === 'balance') {
  await run(`(async () => { ${PRELUDE}
    const txt = t(am().innerText);
    const g = k => { const m = txt.match(new RegExp(k + '\\\\s+(-?[\\\\d,]+\\\\.?\\\\d*)')); return m ? num(m[1]) : null; };
    return { ok: true, account: acct, balance: g('Account Balance'), equity: g('Equity'), profit: g('Profit') };
  })()`);
}

if (cmd === 'positions') {
  await run(`(async () => { ${PRELUDE}
    await openTab('positions');
    return { ok: true, account: acct, positions: tableRows().map(r => t(r.innerText)) };
  })()`);
}

if (cmd === 'orders') {
  await run(`(async () => { ${PRELUDE}
    await openTab('orders');
    const rows = tableRows().map(r => t(r.innerText));
    await openTab('positions');
    return { ok: true, account: acct, orders: rows };
  })()`);
}

if (cmd === 'cancel') {
  const sym = (args[0] || 'NNQ');
  await run(`(async () => { ${PRELUDE}
    const sym = ${JSON.stringify(sym)};
    await openTab('orders');
    const mine = r => /working/i.test(r.innerText) && r.innerText.includes(sym) && !/Take Profit|Stop Loss/i.test(r.innerText) && /Limit/i.test(r.innerText);
    const targets = tableRows().filter(mine);
    const cancelled = [];
    for (const r of targets) {
      cancelled.push(t(r.innerText));
      r.querySelector('[data-name="close-settings-cell-button"]').click();
      await sleep(900);
      await confirmDialog();
    }
    const left = tableRows().map(r => t(r.innerText));
    await openTab('positions');
    return { ok: true, account: acct, cancelled, remaining_rows: left };
  })()`);
}

if (cmd === 'close') {
  const sym = (args[0] || 'NNQ');
  await run(`(async () => { ${PRELUDE}
    const sym = ${JSON.stringify(sym)};
    await openTab('positions');
    const rows = tableRows();
    const row = rows.find(r => r.innerText.includes(sym));
    if (!row) return { ok: true, account: acct, closed: false, note: 'no open position matching ' + sym, positions: rows.map(r => t(r.innerText)) };
    row.querySelector('[data-name="close-settings-cell-button"]').click();
    await sleep(1000);
    const confirm = await confirmDialog();
    await sleep(500);
    const left = tableRows().map(r => t(r.innerText));
    return { ok: true, account: acct, closed: !left.some(x => x.includes(sym)), confirm_clicked: confirm, closed_row: t(row.innerText), positions: left };
  })()`);
}

// Entry orders: BUY|SELL qty sl tp   or   LIMIT BUY|SELL qty price sl tp
const isLimit = cmd === 'limit';
const [sideArg, qtyArg, a3, a4, a5] = isLimit ? args : [cmd, ...args];
const side = (sideArg || '').toLowerCase();
const qty = Number(qtyArg);
const price = isLimit ? Number(a3) : null;
const sl = Number(isLimit ? a4 : a3), tp = Number(isLimit ? a5 : a4);

if (!['buy', 'sell'].includes(side) || !(qty > 0) || !Number.isFinite(sl) || !Number.isFinite(tp) || (isLimit && !Number.isFinite(price)))
  print({ ok: false, error: 'usage: place-order.js <BUY|SELL> <qty> <sl> <tp> | LIMIT <BUY|SELL> <qty> <price> <sl> <tp> | POSITIONS | ORDERS | CANCEL | CLOSE | BALANCE' });
if (side === 'buy' ? !(sl < tp) : !(sl > tp)) print({ ok: false, error: `SL/TP on the wrong side for ${side}` });

// Risk checks run before the browser is touched. Market orders use the live quote, so they are checked in-page.
const checkRR = entry => {
  const risk = Math.abs(entry - sl), reward = Math.abs(tp - entry);
  const netR = (reward - feePts) / (risk + feePts);
  if (risk > maxRisk) return `SL risk ${risk.toFixed(1)} pts is over the ${maxRisk}-pt cap`;
  if (netR < minR) return `net R:R ${netR.toFixed(2)} is under ${minR} (risk ${risk.toFixed(1)}, reward ${reward.toFixed(1)}, fees ${feePts} pts)`;
  return null;
};
if (isLimit) { const bad = checkRR(price); if (bad) print({ ok: false, error: bad }); }

await run(`(async () => { ${PRELUDE}
  const Q = ${JSON.stringify({ side, qty, sl, tp, price, isLimit, dry, maxRisk, minR, feePts })};
  if (!pp()) return { ok: false, error: 'order panel not open' };

  pp().querySelector('[data-name="side-control-' + Q.side + '"]')?.click();
  await sleep(150);
  const tabName = Q.isLimit ? 'Limit' : 'Market';
  const tab = Array.from(pp().querySelectorAll('button, [role="tab"]')).find(b => t(b.textContent) === tabName);
  if (!tab) return { ok: false, error: tabName + ' tab not found' };
  tab.click(); await sleep(250);

  // Live quote from the panel header: "Sell 31,590.0 Buy 31,592.0".
  const head = t(pp().innerText);
  const bid = num((head.match(/Sell\\s+([\\d,]+\\.?\\d*)/) || [])[1]), ask = num((head.match(/Buy\\s+([\\d,]+\\.?\\d*)/) || [])[1]);
  if (!(bid > 0) || !(ask > 0)) return { ok: false, error: 'could not read the live quote', head: head.slice(0, 120) };
  const entry = Q.isLimit ? Q.price : (Q.side === 'buy' ? ask : bid);
  if (Q.isLimit) {
    if (Q.side === 'buy' && Q.price > ask - 2) return { ok: false, error: 'buy limit ' + Q.price + ' is marketable (ask ' + ask + '); it must rest at least 2 pts below', bid, ask };
    if (Q.side === 'sell' && Q.price < bid + 2) return { ok: false, error: 'sell limit ' + Q.price + ' is marketable (bid ' + bid + '); it must rest at least 2 pts above', bid, ask };
  }
  const risk = Math.abs(entry - Q.sl), reward = Math.abs(Q.tp - entry), netR = (reward - Q.feePts) / (risk + Q.feePts);
  if (risk > Q.maxRisk) return { ok: false, error: 'SL risk ' + risk.toFixed(1) + ' pts is over the ' + Q.maxRisk + '-pt cap (entry ' + entry + ')', bid, ask };
  if (netR < Q.minR) return { ok: false, error: 'net R:R ' + netR.toFixed(2) + ' is under ' + Q.minR + ' (entry ' + entry + ', risk ' + risk.toFixed(1) + ', reward ' + reward.toFixed(1) + ')', bid, ask };

  for (const cb of pp().querySelectorAll('input[type="checkbox"]')) if (!cb.checked) { cb.click(); await sleep(80); }
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const txt = Array.from(pp().querySelectorAll('input')).filter(i => i.type === 'text'); // the type attribute is often absent
  const want = Q.isLimit ? 4 : 3;
  if (txt.length < want) return { ok: false, error: 'expected ' + want + ' text inputs, found ' + txt.length };
  const [pIn, qIn, tpIn, slIn] = Q.isLimit ? txt : [null, ...txt];
  if (pIn) { set(pIn, Q.price); await sleep(150); }
  set(qIn, Q.qty); await sleep(150);
  set(tpIn, Q.tp); await sleep(150);
  set(slIn, Q.sl); await sleep(250);

  const back = { price: pIn ? num(pIn.value) : null, qty: num(qIn.value), tp: num(tpIn.value), sl: num(slIn.value),
    checks: Array.from(pp().querySelectorAll('input[type="checkbox"]')).map(c => c.checked) };
  const bad = back.qty !== Q.qty || Math.abs(back.tp - Q.tp) > 0.01 || Math.abs(back.sl - Q.sl) > 0.01 || back.checks.includes(false)
    || (Q.isLimit && Math.abs(back.price - Q.price) > 0.01);
  if (bad) return { ok: false, error: 'inputs did not take', back };

  const btn = pp().querySelector('[data-name="place-and-modify-button"]');
  const label = t(btn?.innerText);
  const sideWord = Q.side === 'buy' ? 'Buy' : 'Sell';
  const labelOk = Q.isLimit
    ? new RegExp('^' + sideWord + ' ' + Q.qty + ' \\\\S+ @ ([\\\\d,\\\\.]+) LIMIT$', 'i').test(label) && Math.abs(num(label.match(/@ ([\\d,\\.]+)/)[1]) - Q.price) < 0.01
    : new RegExp('^' + sideWord + ' ' + Q.qty + ' \\\\S+ MARKET$', 'i').test(label);
  if (!labelOk) return { ok: false, error: 'submit button reads "' + label + '"', back };
  const checks = { entry, risk, reward, net_r: Number(netR.toFixed(2)), bid, ask };
  if (Q.dry) return { ok: true, dry: true, account: acct, label, back, checks };
  btn.click();
  await sleep(1500);
  const confirm = Array.from(document.querySelectorAll('button')).find(b => /^(Confirm|Place order|OK)$/i.test(t(b.textContent)));
  if (confirm) { confirm.click(); await sleep(1500); }
  return { ok: true, account: acct, label, back, checks, confirm_clicked: !!confirm, account_panel: t(am()?.innerText).slice(0, 400) };
})()`);
