const { clean, isEmail, getMailConfig, getTransporter } = require('./_lib/mailer');

const ROLES = [
  'HR / Chief People Officer',
  'Operations / COO',
  'Compliance / DPO',
  'IT / CTO',
  'CEO / MD',
  'Other',
];

const SIZES = ['10–50', '51–150', '151–300', '301–500', '500+'];
const CONSENT_TEXT = "I'd like Ethilytics to contact me about an EPIP demo and the pilot programme.";

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'demo-request',
      smtpConfigured: Boolean(
        process.env.SMTP_HOST &&
        process.env.SMTP_PORT &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.NOTIFY_TO
      ),
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body = req.body || {};

    if (clean(body.website)) {
      return res.status(200).json({ ok: true });
    }

    const data = {
      name: clean(body.name, 120),
      email: clean(body.email, 200),
      company: clean(body.company, 200),
      role: ROLES.includes(body.role) ? body.role : clean(body.role, 80),
      size: SIZES.includes(body.size) ? body.size : clean(body.size, 40),
      msg: clean(body.msg, 2000),
      consent: body.consent === true,
    };

    const errors = {};
    if (!data.name) errors.name = 'required';
    if (!data.email || !isEmail(data.email)) errors.email = 'invalid';
    if (!data.company) errors.company = 'required';
    if (!data.consent) errors.consent = 'required';

    if (Object.keys(errors).length) {
      return res.status(400).json({ ok: false, errors });
    }

    const config = getMailConfig();
    const transporter = getTransporter(config);
    const reference = `req_${Date.now().toString(36)}`;
    const submittedAt = new Date().toISOString();

    await transporter.sendMail({
      from: `"Ethilytics website" <${config.from}>`,
      to: config.notifyTo,
      replyTo: data.email,
      subject: `Demo request — ${data.company} (${data.role || 'role n/a'})`,
      text:
        `New EPIP demo/pilot request\n\n` +
        `Name:    ${data.name}\n` +
        `Email:   ${data.email}\n` +
        `Org:     ${data.company}\n` +
        `Role:    ${data.role || '(not supplied)'}\n` +
        `Team:    ${data.size || '(not supplied)'}\n\n` +
        `Hoping to solve:\n${data.msg || '(none)'}\n\n` +
        `Consent: yes — "${CONSENT_TEXT}" at ${submittedAt}\n` +
        `Ref: ${reference}\n`,
    });

    await transporter.sendMail({
      from: `"Ethilytics" <${config.from}>`,
      to: data.email,
      replyTo: config.notifyTo,
      subject: 'Thanks — we’ll be in touch about your EPIP demo',
      text:
        `Hi ${data.name.split(' ')[0] || 'there'},\n\n` +
        `Thanks for requesting a demo of EPIP. A member of the Ethilytics team will email ` +
        `you within two working days to arrange it and talk through the pilot. ` +
        `No automated sequences, no sales spam.\n\n` +
        `Your details are processed under UK GDPR and never shared. Reply to this email ` +
        `at any time to ask us to delete them.\n\n` +
        `— Ethilytics\n`,
    });

    return res.status(200).json({ ok: true, reference });
  } catch (error) {
    console.error('demo-request error:', {
      message: error && error.message,
      code: error && error.code,
      command: error && error.command,
      responseCode: error && error.responseCode,
    });

    const configurationError = error && error.code === 'SMTP_CONFIG_MISSING';
    return res.status(500).json({
      ok: false,
      error: configurationError ? 'smtp_not_configured' : 'send_failed',
    });
  }
};
