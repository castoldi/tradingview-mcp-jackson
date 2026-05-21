#!/usr/bin/env node
// Paper-trade order placement on TradingView desktop via CDP.
// Usage: node scripts/place-trade.js <side> <qty> <sl> <tp> [symbol]
//   side: BUY | SELL
//   qty:  integer units
//   sl:   stop-loss price (absolute)
//   tp:   take-profit price (absolute)
// Connects to localhost:9222 (TV must be launched with --remote-debugging-port=9222).
// Soft-fails (exit 0) on any error so the trading loop keeps running.

import CDP from 'chrome-remote-interface';

const [,, sideArg, qtyArg, slArg, tpArg, symbolArg = 'OANDA:SPX500USD'] = process.argv;

if (!sideArg || !qtyArg || !slArg || !tpArg) {
  console.error('Usage: node place-trade.js <BUY|SELL> <qty> <sl> <tp> [symbol]');
  process.exit(1);
}

const side = sideArg.toLowerCase();
if (side !== 'buy' && side !== 'sell') {
  console.error(`Bad side: ${sideArg}. Use BUY or SELL.`);
  process.exit(1);
}
const qty = Number(qtyArg);
const sl = Number(slArg);
const tp = Number(tpArg);
if (!Number.isFinite(qty) || !Number.isFinite(sl) || !Number.isFinite(tp)) {
  console.error('qty/sl/tp must be numbers');
  process.exit(1);
}

const CDP_HOST = 'localhost';
const CDP_PORT = 9222;

async function findTradingViewTarget() {
  const targets = await CDP.List({ host: CDP_HOST, port: CDP_PORT });
  const tv = targets.find(t =>
    t.type === 'page' &&
    /tradingview\.com\/chart/i.test(t.url || '')
  );
  if (!tv) throw new Error('No TradingView chart tab found on CDP');
  return tv;
}

// JS injected into the TradingView page to drive the order panel.
// Returns { ok, error?, submitText? }
const placeOrderJs = `
(async () => {
  const params = ${JSON.stringify({ side, qty, sl, tp })};
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function setReactInputValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  let panel = document.querySelector('[data-name="order-panel"]');
  if (!panel) {
    // Try to open it via the "Trade" header button
    const tradeBtn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim() === 'Trade');
    if (tradeBtn) { tradeBtn.click(); await sleep(400); }
    panel = document.querySelector('[data-name="order-panel"]');
    if (!panel) return { ok: false, error: 'order panel not open' };
  }

  // 1. Select side
  const sideEl = panel.querySelector('[data-name="side-control-' + params.side + '"]');
  if (!sideEl) return { ok: false, error: 'side-control-' + params.side + ' not found' };
  sideEl.click();
  await sleep(120);

  // 2. Switch to Market order type
  const tabs = panel.querySelectorAll('button, [role="tab"]');
  let marketTab = null;
  for (const t of tabs) {
    if ((t.textContent || '').trim() === 'Market') { marketTab = t; break; }
  }
  if (marketTab) {
    marketTab.click();
    await sleep(200);
  }

  // 3. Enable TP and SL checkboxes (so the price inputs are active)
  const checkboxes = panel.querySelectorAll('input[type="checkbox"]');
  for (const cb of checkboxes) {
    if (!cb.checked) { cb.click(); await sleep(50); }
  }

  // 4. Locate the price-related text inputs.
  // After Market + both exits enabled: inputs are [qty, tp_price, sl_price] in DOM order.
  // We'll be defensive: re-query and pick by surrounding label text where possible.
  const textInputs = Array.from(panel.querySelectorAll('input[type="text"]'));

  // Helper: find input whose nearest preceding label/text contains a keyword
  function findInputByLabel(keywords) {
    for (const inp of textInputs) {
      let walker = inp;
      for (let i = 0; i < 6 && walker; i++) {
        const txt = (walker.parentElement?.textContent || '').toLowerCase();
        if (keywords.some(k => txt.includes(k))) return inp;
        walker = walker.parentElement;
      }
    }
    return null;
  }

  // Try label-based lookup first; fall back to positional.
  let qtyInput = findInputByLabel(['units', 'quantity']) ;
  let tpInput  = findInputByLabel(['take profit', 'take-profit', 'tp ']);
  let slInput  = findInputByLabel(['stop loss', 'stop-loss', 'sl ']);

  // Positional fallback (after Market + TP/SL enabled): [qty, tp, sl]
  if (!qtyInput && textInputs[0]) qtyInput = textInputs[0];
  if (!tpInput && textInputs[1]) tpInput = textInputs[1];
  if (!slInput && textInputs[2]) slInput = textInputs[2];

  if (!qtyInput || !tpInput || !slInput) {
    return { ok: false, error: 'could not locate qty/tp/sl inputs (found ' + textInputs.length + ' text inputs)' };
  }

  // 5. Set values
  setReactInputValue(qtyInput, params.qty);
  await sleep(80);
  setReactInputValue(tpInput, params.tp);
  await sleep(80);
  setReactInputValue(slInput, params.sl);
  await sleep(150);

  // 6. Submit
  const submit = panel.querySelector('[data-name="place-and-modify-button"]');
  if (!submit) return { ok: false, error: 'submit button not found' };
  const submitText = (submit.textContent || '').trim();
  submit.click();
  await sleep(300);

  return { ok: true, submitText };
})()
`;

(async () => {
  let client;
  try {
    const target = await findTradingViewTarget();
    client = await CDP({ target: target.webSocketDebuggerUrl });
    const { Runtime } = client;
    await Runtime.enable();
    const { result, exceptionDetails } = await Runtime.evaluate({
      expression: placeOrderJs,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      console.error('JS exception:', JSON.stringify(exceptionDetails, null, 2));
      process.exit(0);
    }
    const payload = result.value;
    if (!payload || !payload.ok) {
      console.error('Order placement failed:', payload && payload.error);
      process.exit(0);
    }
    console.log('Order placed:', side.toUpperCase(), qty, symbolArg, 'SL', sl, 'TP', tp, '| submit:', payload.submitText);
  } catch (err) {
    console.error('place-trade error:', err.message);
    process.exit(0);
  } finally {
    if (client) await client.close();
  }
})();
