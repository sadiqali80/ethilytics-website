const { clean, isEmail, getMailConfig, getTransporter } = require('./_lib/mailer');

const CONSENT_TEXT = "I'd like Ethilytics to consider my application for this role and contact me about it.";
const ROLE_TITLE = 'Chief Technology Officer';

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'job-application',
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
      phone: clean(body.phone, 60),
      linkedin: clean(body.linkedin, 300),
      portfolio: clean(body.portfolio, 300),
      currentRole: clean(body.currentRole, 200),
      message: clean(body.message, 3000),
      consent: body.consent === true,
    };

    const errors = {};
    if (!data.name) errors.name = 'required';
    if (!data.email || !isEmail(data.email)) errors.email = 'invalid';
    if (!data.linkedin && !data.portfolio) errors.links = 'required';
    if (!data.consent) errors.consent = 'required';

    if (Object.keys(errors).length) {
      return res.status(400).json({ ok: false, errors });
    }

    const config = getMailConfig();
    const transporter = getTransporter(config);
    const notifyTo = clean(process.env.CAREERS_NOTIFY_TO, 255) || config.notifyTo;
    const reference = `job_${Date.now().toString(36)}`;
    const submittedAt = new Date().toISOString();

    await transporter.sendMail({
      from: `"Ethilytics careers" <${config.user}>`,
      to: notifyTo,
      replyTo: data.email,
      subject: `Job application — ${ROLE_TITLE} — ${data.name}`,
      text:
        `New application for ${ROLE_TITLE}\n\n` +
        `Name:      ${data.name}\n` +
        `Email:     ${data.email}\n` +
        `Phone:     ${data.phone || '(not supplied)'}\n` +
        `LinkedIn:  ${data.linkedin || '(not supplied)'}\n` +
        `Portfolio: ${data.portfolio || '(not supplied)'}\n` +
        `Current:   ${data.currentRole || '(not supplied)'}\n\n` +
        `Why this role:\n${data.message || '(none)'}\n\n` +
        `Consent: yes — "${CONSENT_TEXT}" at ${submittedAt}\n` +
        `Ref: ${reference}\n`,
    });

    await transporter.sendMail({
      from: `"Ethilytics" <${config.user}>`,
      to: data.email,
      replyTo: notifyTo,
      subject: `We've received your application — ${ROLE_TITLE} at Ethilytics`,
      text:
        `Hi ${data.name.split(' ')[0] || 'there'},\n\n` +
        `Thanks for applying for ${ROLE_TITLE} at Ethilytics. A member of the founding team ` +
        `reads every application personally. If there's a fit, we'll be in touch within two ` +
        `weeks to arrange a conversation.\n\n` +
        `Your details are processed under UK GDPR for recruitment purposes only, and never ` +
        `shared. Reply to this email at any time to ask us to delete them.\n\n` +
        `— Ethilytics\n`,
    });

    return res.status(200).json({ ok: true, reference });
  } catch (error) {
    console.error('job-application error:', {
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
