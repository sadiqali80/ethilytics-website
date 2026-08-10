const nodemailer = require('nodemailer');

const clean = (value, max = 500) => String(value || '').trim().slice(0, max);
const isEmail = (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

let cachedTransporter;

function getMailConfig() {
  const host = clean(process.env.SMTP_HOST || 'smtpout.secureserver.net', 255);
  const port = Number(process.env.SMTP_PORT || 587);
  const user = clean(process.env.SMTP_USER, 255);
  const pass = String(process.env.SMTP_PASS || '');
  const notifyTo = clean(process.env.NOTIFY_TO || user, 255);

  if (!host || !Number.isFinite(port) || !user || !pass || !notifyTo) {
    const error = new Error('Missing required SMTP environment variables.');
    error.code = 'SMTP_CONFIG_MISSING';
    throw error;
  }

  return { host, port, user, pass, notifyTo };
}

function getTransporter(config) {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      requireTLS: true,

      auth: {
        user: config.user,
        pass: config.pass,
      },

      tls: {
        minVersion: 'TLSv1.2',
        servername: config.host,
      },

      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
    });
  }
  return cachedTransporter;
}

module.exports = { clean, isEmail, getMailConfig, getTransporter };
