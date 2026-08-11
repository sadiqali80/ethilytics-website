// Serves the static site and receives the demo and job-application forms,
// sending a team notification plus an autoresponder for each via Titan SMTP.
// Credentials live only in environment variables (see .env.example).

require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const path = require('path');
const fs = require('fs');
const express = require('express');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const app = express();
app.set('trust proxy', 1); // needed if behind a proxy/load balancer for correct IPs
// CVs are submitted as base64 JSON, so this route needs a larger body limit than the rest of the API.
app.use('/api/job-application', express.json({ limit: '4mb' }));
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.office365.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = SMTP_PORT === 465; // port 465 = implicit TLS from the start; port 587 = STARTTLS

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  requireTLS: !SMTP_SECURE,

  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },

  tls: {
    minVersion: 'TLSv1.2',
    servername: SMTP_HOST,
  },

  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 30000,
});

transporter.verify().then(
  () => console.log('SMTP ready'),
  (err) => console.error('SMTP config error:', err.message)
);

const limiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

const ROLES = ['HR / Chief People Officer', 'Operations / COO', 'Compliance / DPO', 'IT / CTO', 'CEO / MD', 'Other'];
const SIZES = ['10–50', '51–150', '151–300', '301–500', '500+'];
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const clean = (v, max = 500) => String(v || '').trim().slice(0, max);

const DEMO_CONSENT_TEXT = "I'd like Ethilytics to contact me about an EPIP demo and the pilot programme.";
const JOB_CONSENT_TEXT = "I'd like Ethilytics to consider my application for this role and contact me about it.";
const CTO_ROLE_TITLE = 'Chief Technology Officer';

const CV_MAX_BYTES = 2 * 1024 * 1024; // 2MB — keeps the base64 JSON payload safely under serverless body-size limits
const CV_ALLOWED_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};
const isDob = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime()) && new Date(v) < new Date();

app.post('/api/demo-request', limiter, async (req, res) => {
  try {
    const b = req.body || {};

    // honeypot: if a hidden "website" field is filled, it's a bot. Accept silently, send nothing.
    if (clean(b.website)) return res.json({ ok: true });

    // optional: Cloudflare Turnstile verification (uncomment and set TURNSTILE_SECRET)
    // const ok = await verifyTurnstile(b.token, req.ip); if (!ok) return res.status(400).json({ ok:false, error:'captcha' });

    const data = {
      name: clean(b.name, 120),
      email: clean(b.email, 200),
      company: clean(b.company, 200),
      role: ROLES.includes(b.role) ? b.role : clean(b.role, 80),
      size: SIZES.includes(b.size) ? b.size : clean(b.size, 40),
      msg: clean(b.msg, 2000),
      consent: b.consent === true,
    };

    const errs = {};
    if (!data.name) errs.name = 'required';
    if (!data.email || !isEmail(data.email)) errs.email = 'invalid';
    if (!data.company) errs.company = 'required';
    if (!data.consent) errs.consent = 'required';
    if (Object.keys(errs).length) return res.status(400).json({ ok: false, errors: errs });

    // Replace the JSONL append with a real database before relying on this in production.
    const record = {
      id: 'req_' + Date.now().toString(36),
      ...data,
      consentText: DEMO_CONSENT_TEXT,
      consentAt: new Date().toISOString(),
      ip: req.ip, // personal data: keep retention short, document in your RoPA, or drop this line
    };
    fs.appendFileSync(path.join(__dirname, 'submissions.log'), JSON.stringify(record) + '\n');

    await transporter.sendMail({
      from: `"Ethilytics website" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
      to: process.env.NOTIFY_TO,
      replyTo: data.email,
      subject: `Demo request — ${data.company} (${data.role || 'role n/a'})`,
      text:
        `New EPIP demo/pilot request\n\n` +
        `Name:    ${data.name}\nEmail:   ${data.email}\nOrg:     ${data.company}\n` +
        `Role:    ${data.role}\nTeam:    ${data.size}\n\nHoping to solve:\n${data.msg || '(none)'}\n\n` +
        `Consent: yes — "${DEMO_CONSENT_TEXT}" at ${record.consentAt}\nRef: ${record.id}\n`,
    });

    await transporter.sendMail({
      from: `"Ethilytics" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
      to: data.email,
      subject: 'Thanks — we’ll be in touch about your EPIP demo',
      text:
        `Hi ${data.name.split(' ')[0] || 'there'},\n\n` +
        `Thanks for requesting a demo of EPIP. A member of the Ethilytics team will email ` +
        `you within two working days to arrange it and talk through the pilot. ` +
        `No automated sequences, no sales spam.\n\n` +
        `Your details are processed under UK GDPR and never shared. Reply to this email ` +
        `any time to ask us to delete them.\n\n— Ethilytics\n`,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('demo-request error:', err);
    return res.status(500).json({ ok: false, error: 'send_failed' });
  }
});

app.post('/api/job-application', limiter, async (req, res) => {
  try {
    const b = req.body || {};

    if (clean(b.website)) return res.json({ ok: true });

    const data = {
      firstName: clean(b.firstName, 80),
      lastName: clean(b.lastName, 80),
      dob: clean(b.dob, 10),
      email: clean(b.email, 200),
      consent: b.consent === true,
    };

    const cvFilename = clean(b.cvFilename, 150).replace(/[^a-zA-Z0-9 ._-]/g, '_');
    const cvType = clean(b.cvType, 150);
    const cvBase64 = typeof b.cvBase64 === 'string' ? b.cvBase64 : '';
    const cvExt = (cvFilename.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();

    const errs = {};
    if (!data.firstName) errs.firstName = 'required';
    if (!data.lastName) errs.lastName = 'required';
    if (!isDob(data.dob)) errs.dob = 'invalid';
    if (!data.email || !isEmail(data.email)) errs.email = 'invalid';
    if (!data.consent) errs.consent = 'required';

    let cvBuffer = null;
    if (!cvBase64 || !cvFilename) {
      errs.cv = 'required';
    } else if (!CV_ALLOWED_TYPES[cvType] && !Object.values(CV_ALLOWED_TYPES).includes(cvExt)) {
      errs.cv = 'type';
    } else {
      cvBuffer = Buffer.from(cvBase64, 'base64');
      if (cvBuffer.length === 0 || cvBuffer.length > CV_MAX_BYTES) errs.cv = 'size';
    }

    if (Object.keys(errs).length) return res.status(400).json({ ok: false, errors: errs });

    const fullName = `${data.firstName} ${data.lastName}`.trim();
    const record = {
      id: 'job_' + Date.now().toString(36),
      role: CTO_ROLE_TITLE,
      ...data,
      cvFilename,
      cvType,
      cvBytes: cvBuffer.length,
      consentText: JOB_CONSENT_TEXT,
      consentAt: new Date().toISOString(),
      ip: req.ip,
    };
    fs.appendFileSync(path.join(__dirname, 'applications.log'), JSON.stringify(record) + '\n');

    const notifyTo = process.env.CAREERS_NOTIFY_TO || process.env.NOTIFY_TO;

    await transporter.sendMail({
      from: `"Ethilytics careers" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
      to: notifyTo,
      replyTo: data.email,
      subject: `Job application — ${CTO_ROLE_TITLE} — ${fullName}`,
      text:
        `New application for ${CTO_ROLE_TITLE}\n\n` +
        `First name:    ${data.firstName}\nLast name:     ${data.lastName}\n` +
        `Date of birth: ${data.dob}\nEmail:         ${data.email}\n\n` +
        `CV attached: ${cvFilename}\n\n` +
        `Consent: yes — "${JOB_CONSENT_TEXT}" at ${record.consentAt}\nRef: ${record.id}\n`,
      attachments: [{ filename: cvFilename, content: cvBuffer, contentType: cvType || undefined }],
    });

    await transporter.sendMail({
      from: `"Ethilytics" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
      to: data.email,
      replyTo: notifyTo,
      subject: `We've received your application — ${CTO_ROLE_TITLE} at Ethilytics`,
      text:
        `Hi ${data.firstName || 'there'},\n\n` +
        `Thanks for applying for ${CTO_ROLE_TITLE} at Ethilytics. A member of the founding ` +
        `team reads every application personally. If there's a fit, we'll be in touch within ` +
        `two weeks to arrange a conversation.\n\n— Ethilytics\n`,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('job-application error:', err);
    return res.status(500).json({ ok: false, error: 'send_failed' });
  }
});

// async function verifyTurnstile(token, ip) {
//   const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
//     method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
//     body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: token || '', remoteip: ip }),
//   });
//   const j = await r.json(); return j.success === true;
// }

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ethilytics site + API on http://localhost:${PORT}`));
