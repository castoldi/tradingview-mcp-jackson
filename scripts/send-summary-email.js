#!/usr/bin/env node
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;

async function sendSummaryEmail(subject, body) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !NOTIFY_EMAIL) {
    console.log(`[WARN] Email credentials missing. Subject: ${subject}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: GMAIL_USER,
      to: NOTIFY_EMAIL,
      subject,
      text: body,
      html: `<pre>${body}</pre>`,
    });
    console.log(`[OK] Email sent: ${info.messageId}`);
  } catch (err) {
    console.error(`[ERROR] Failed to send email: ${err.message}`);
  }
}

const subject = process.argv[2] || 'Trading Day Summary';
const body = process.argv[3] || 'No summary data available.';

sendSummaryEmail(subject, body);
