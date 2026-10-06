#!/usr/bin/env node
// Read the connected broker account's fills from TradingView's Account Manager via CDP.
// Usage: node scripts/broker-fills.js [--json]
// Prints account balance, realized P&L, the Orders tab (filled/cancelled orders with avg fill
// prices) and the Notifications log (every order placed/modified/executed, with timestamps, so
// trailing-stop moves are visible). Read-only: it only clicks the bottom-panel tabs and returns
// to Positions when done. Requires TradingView running with --remote-debugging-port=9222.

import { evaluate, disconnect } from '../src/connection.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clickTab = name => evaluate(`(() => {
  const am = document.querySelector('#bottom-area');
  if (!am) return false;
  const el = Array.from(am.querySelectorAll('button,[role=tab],div,span'))
    .find(e => e.textContent.trim() === ${JSON.stringify(name)} && e.children.length <= 1);
  if (el) el.click();
  return !!el;
})()`);
const panelText = () => evaluate(`(document.querySelector('#bottom-area')?.innerText || '')`);
const clean = t => t.replace(/\n\t\n/g, ' | ').replace(/\t/g, ' ').replace(/\n{2,}/g, '\n').trim();

const out = {};
try {
  for (const tab of ['Account summary', 'Orders', 'Notifications log']) {
    if (!(await clickTab(tab))) { out[tab] = '(tab not found - is the Account Manager panel open?)'; continue; }
    await sleep(1500);
    out[tab] = clean(await panelText());
  }
  await clickTab('Positions');
} catch (e) {
  console.error('broker-fills: ' + e.message);
  process.exitCode = 1;
}
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else for (const [k, v] of Object.entries(out)) console.log(`=== ${k} ===\n${v}\n`);
await disconnect().catch(() => {});
process.exit();
