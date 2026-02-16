const nodemailer = require('nodemailer');
const { buildPasswordResetTemplate } = require('../templates/emails/password-reset-template');
const { buildEmailVerificationTemplate } = require('../templates/emails/email-verification-template');

let transporter;
let usingJsonTransport = false;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = parseBoolean(process.env.SMTP_SECURE, false);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();

  if (!host) {
    usingJsonTransport = true;
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  const auth = user ? { user, pass } : undefined;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
  });
  usingJsonTransport = false;
  return transporter;
}

async function sendViaSmtp2go({ toEmail, subject, html, text }) {
  const apiKey = String(process.env.SMTP2GO_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }

  const endpoint = String(
    process.env.SMTP2GO_API_URL || 'https://api.smtp2go.com/v3/email/send'
  ).trim();
  const fromEmail = String(
    process.env.SMTP_FROM_EMAIL || 'no-reply@bizassistant.local'
  ).trim();
  const fromName = String(process.env.SMTP_FROM_NAME || 'Biz Assistant').trim();

  const payload = {
    sender: fromEmail,
    sender_name: fromName,
    to: [toEmail],
    subject,
    html_body: html,
    text_body: text,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Smtp2go-Api-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    parsed = null;
  }

  if (!response.ok) {
    const reason = parsed?.data?.error || parsed?.error || raw || `HTTP ${response.status}`;
    throw new Error(`SMTP2GO send failed: ${reason}`);
  }

  if (parsed && String(parsed.data?.succeeded || '0') === '0') {
    const reason = parsed?.data?.error || 'SMTP2GO rejected message.';
    throw new Error(`SMTP2GO send failed: ${reason}`);
  }

  return parsed || { ok: true };
}

async function sendMail({ toEmail, subject, html, text }) {
  const fromName = String(process.env.SMTP_FROM_NAME || 'Biz Assistant').trim();
  const fromEmail = String(process.env.SMTP_FROM_EMAIL || 'no-reply@bizassistant.local').trim();
  const from = `${fromName} <${fromEmail}>`;

  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const smtp2goApiKey = String(process.env.SMTP2GO_API_KEY || '').trim();

  if (smtp2goApiKey) {
    const smtp2goResult = await sendViaSmtp2go({ toEmail, subject, html, text });
    if (smtp2goResult) {
      return smtp2goResult;
    }
  }

  if (isProduction) {
    throw new Error(
      'SMTP2GO_API_KEY is required in production. SMTP fallback is disabled.'
    );
  }

  const mail = {
    from,
    to: toEmail,
    subject,
    html,
    text,
  };

  const client = getTransporter();
  const info = await client.sendMail(mail);
  if (usingJsonTransport) {
    console.log('Email transport is in json mode. Message payload:', info.message || info);
  }
  return info;
}

async function sendPasswordResetEmail({
  toEmail,
  toName,
  resetUrl,
  expiresInMinutes = 30,
}) {
  const template = buildPasswordResetTemplate({
    brandName: String(process.env.APP_NAME || 'Biz Assistant').trim(),
    recipientName: toName,
    resetUrl,
    expiresInMinutes,
  });

  return sendMail({
    toEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

async function sendEmailVerificationEmail({
  toEmail,
  toName,
  verifyUrl,
  expiresInMinutes = 60,
}) {
  const template = buildEmailVerificationTemplate({
    brandName: String(process.env.APP_NAME || 'Biz Assistant').trim(),
    recipientName: toName,
    verifyUrl,
    expiresInMinutes,
  });

  return sendMail({
    toEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

module.exports = {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
};
