const { clean, isEmail, getMailConfig, getTransporter } = require('./_lib/mailer');

const CONSENT_TEXT = "I'd like Ethilytics to consider my application for this role and contact me about it.";
const ROLE_TITLE = 'Chief Technology Officer';

const CV_MAX_BYTES = 2 * 1024 * 1024; // 2MB — keeps the base64 JSON payload safely under serverless body-size limits
const CV_ALLOWED_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};
const isDob = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime()) && new Date(v) < new Date();

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
      firstName: clean(body.firstName, 80),
      lastName: clean(body.lastName, 80),
      dob: clean(body.dob, 10),
      email: clean(body.email, 200),
      consent: body.consent === true,
    };

    const cvFilename = clean(body.cvFilename, 150).replace(/[^a-zA-Z0-9 ._-]/g, '_');
    const cvType = clean(body.cvType, 150);
    const cvBase64 = typeof body.cvBase64 === 'string' ? body.cvBase64 : '';
    const cvExt = (cvFilename.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();

    const errors = {};
    if (!data.firstName) errors.firstName = 'required';
    if (!data.lastName) errors.lastName = 'required';
    if (!isDob(data.dob)) errors.dob = 'invalid';
    if (!data.email || !isEmail(data.email)) errors.email = 'invalid';
    if (!data.consent) errors.consent = 'required';

    let cvBuffer = null;
    if (!cvBase64 || !cvFilename) {
      errors.cv = 'required';
    } else if (!CV_ALLOWED_TYPES[cvType] && !Object.values(CV_ALLOWED_TYPES).includes(cvExt)) {
      errors.cv = 'type';
    } else {
      cvBuffer = Buffer.from(cvBase64, 'base64');
      if (cvBuffer.length === 0 || cvBuffer.length > CV_MAX_BYTES) errors.cv = 'size';
    }

    if (Object.keys(errors).length) {
      return res.status(400).json({ ok: false, errors });
    }

    const fullName = `${data.firstName} ${data.lastName}`.trim();
    const config = getMailConfig();
    const transporter = getTransporter(config);
    const notifyTo = clean(process.env.CAREERS_NOTIFY_TO, 255) || config.notifyTo;
    const reference = `job_${Date.now().toString(36)}`;
    const submittedAt = new Date().toISOString();

    await transporter.sendMail({
      from: `"Ethilytics careers" <${config.user}>`,
      to: notifyTo,
      replyTo: data.email,
      subject: `Job application — ${ROLE_TITLE} — ${fullName}`,
      text:
        `New application for ${ROLE_TITLE}\n\n` +
        `First name:    ${data.firstName}\n` +
        `Last name:     ${data.lastName}\n` +
        `Date of birth: ${data.dob}\n` +
        `Email:         ${data.email}\n\n` +
        `CV attached: ${cvFilename}\n\n` +
        `Consent: yes — "${CONSENT_TEXT}" at ${submittedAt}\n` +
        `Ref: ${reference}\n`,
      attachments: [{ filename: cvFilename, content: cvBuffer, contentType: cvType || undefined }],
    });

    await transporter.sendMail({
      from: `"Ethilytics" <${config.user}>`,
      to: data.email,
      replyTo: notifyTo,
      subject: `We've received your application — ${ROLE_TITLE} at Ethilytics`,
      text:
        `Hi ${data.firstName || 'there'},\n\n` +
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
