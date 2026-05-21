#!/usr/bin/env node
// Trade email notifier — call from trading loop after a trade is placed.
// Usage: node scripts/notify-trade.js <direction> <price> <lots> <sl> <tp> <symbol>
// Reads GMAIL_USER and GMAIL_APP_PASSWORD from .env

import { createTransport } from 'nodemailer';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const [,, direction, price, lots, sl, tp, symbol = 'EURUSD'] = process.argv;

if (!direction || !price || !lots || !sl || !tp) {
  console.error('Usage: node notify-trade.js <direction> <price> <lots> <sl> <tp> [symbol]');
  process.exit(1);
}

const { GMAIL_USER, GMAIL_APP_PASSWORD, NOTIFY_EMAIL } = process.env;

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error('Missing GMAIL_USER or GMAIL_APP_PASSWORD in .env — email not sent.');
  process.exit(0); // soft fail, don't break the trading loop
}

const to = NOTIFY_EMAIL || GMAIL_USER;
const side = direction.toUpperCase();
const emoji = side === 'BUY' ? '📈' : '📉';
const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

const transport = createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

const subject = `${emoji} ${side} ${symbol} @ ${price}`;
const text = `
Trade executed by TradingView bot
──────────────────────────────────
Symbol:    ${symbol}
Direction: ${side}
Entry:     ${price}
Lots:      ${lots}
Stop Loss: ${sl}
Take Profit: ${tp}
Time (ET): ${now}
──────────────────────────────────
Max risk: ~$100
`;

try {
  const info = await transport.sendMail({ from: GMAIL_USER, to, subject, text });
  console.log('Email sent:', info.messageId);
} catch (err) {
  console.error('Email failed:', err.message);
  process.exit(0); // soft fail
}
