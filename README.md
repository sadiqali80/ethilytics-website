# Ethilytics EPIP — website & careers page

This repository is the Ethilytics marketing site: a multi-page site (home, product, pricing, about, contact, careers) and the server-side handlers that send email when either form is submitted.

## Project structure

```
public/
  index.html         home: hero + short teasers linking out to each page below
  product.html        how EPIP works, what it never does, demo video, compliance & trust
  pricing.html         the three pilot tiers (Basic / Standard / Enterprise)
  about.html            who Ethilytics is and what we believe
  contact.html           the "Book a demo" form (POST /api/demo-request)
  careers.html            the careers page and CTO application form
server/
  server.js          Express server for local development (npm start)
api/
  demo-request.js     Vercel function: handles the "Book a demo" form
  job-application.js  Vercel function: handles the careers application form
  _lib/mailer.js       shared SMTP transport used by both functions above
```

Every page in `public/` is a plain, hand-authored HTML file in the same visual style (IBM Plex Sans + Source Serif 4, the navy/teal palette), each with its own header nav, footer, and meta/OG tags. None of them need a build step. Shared header/footer markup is duplicated per page rather than templated, matching how `careers.html` was originally built.

Both forms only send real email when a server is running: either `server/server.js` locally, or the `api/` functions once deployed to Vercel.

## Run it locally

```bash
npm install
cp .env.example .env      # then fill in your SMTP password
npm start                 # serves the site + API at http://localhost:3000
```

Open http://localhost:3000. Submitting either form sends a team notification to `NOTIFY_TO` (or `CAREERS_NOTIFY_TO` for applications) plus a confirmation email to the person who submitted it.

## Just want to preview the pages?

Open any file in `public/` directly in a browser, or serve the `public/` folder with any static host. Every page renders fully without a server. Forms only send email once a server is running at `/api/demo-request` and `/api/job-application`.

## Email configuration

Fill `.env` (gitignored, never commit it):

```
SMTP_HOST=smtp.titan.email
SMTP_PORT=465
SMTP_USER=hello@ethilytics.co.uk
SMTP_PASS=********
NOTIFY_TO=hello@ethilytics.co.uk
# CAREERS_NOTIFY_TO=hello@ethilytics.co.uk   optional, falls back to NOTIFY_TO
```

IMAP is only for reading mail in a client; the forms only need SMTP. IMAP values are left commented in `.env.example` for reference.

## Careers page and the application form

`public/careers.html` lists the current open role and its application form, and posts to `POST /api/job-application` rather than `/api/demo-request`. It's a separate endpoint with its own validation, its own consent text, and its own email copy, because a job application is a different kind of request from a sales lead: different data, a different legal basis for holding it, and a different reply. Keeping them separate also means the two can be routed to different inboxes later (`NOTIFY_TO` vs `CAREERS_NOTIFY_TO`) without touching the demo-request flow at all.

The application form asks for a LinkedIn profile and/or a portfolio/CV link rather than a file upload — neither backend currently parses file uploads, and adding that (a multipart parser, attachment handling, Vercel payload limits) is a reasonable next step if the hiring process later needs it, but wasn't necessary for this listing.

## Deploying on Vercel

Vercel only deploys serverless functions from the `api/` folder, so `server/server.js`'s routes aren't used in production — `api/demo-request.js` and `api/job-application.js` are the deployed equivalents, sharing SMTP setup through `api/_lib/mailer.js`.

Add these under **Vercel project → Settings → Environment Variables** (enable at least Production):

```
SMTP_HOST=smtp.titan.email
SMTP_PORT=465
SMTP_USER=your-full-titan-mailbox@example.com
SMTP_PASS=your-titan-mailbox-password
NOTIFY_TO=where-demo-notifications-should-arrive@example.com
CAREERS_NOTIFY_TO=where-applications-should-arrive@example.com
```

Don't include comments after values in the Vercel dashboard, and don't commit `.env`. Redeploy after adding or changing variables.

To verify a deployment before relying on it, open `https://YOUR-DOMAIN.vercel.app/api/demo-request` or `/api/job-application` — each returns `{"ok":true,"service":"...","smtpConfigured":true}` when configured correctly. If `smtpConfigured` is false, the variables are missing from that deployment or were added to the wrong Vercel environment. If a submission still fails, check the failed function invocation under **Vercel → Project → Logs**; it logs safe diagnostic fields (SMTP error and response codes) without printing the password.

## Before you go live

1. **SEO** — every page is static, server-rendered markup with its own title, meta description, and OG tags, so this is in good shape by default.
2. **Spam** — both forms already drop silently on a filled honeypot field. Consider enabling Cloudflare Turnstile too (a commented-out stub is in `server/server.js`).
3. **GDPR** — submissions append to `server/submissions.log` and `server/applications.log` locally, with consent text and a timestamp (the Vercel functions don't write these, since the deployed filesystem is read-only). Move this to a real database, set a retention period, and document it in your RoPA.
4. **Assets** — add a 1200×630 `og-image.png` and a favicon to `public/`, and confirm the Companies House number and any remaining placeholder copy read the way you want them to.
5. **Test** — Lighthouse 90+, a keyboard-only pass, an OG preview check, and one real end-to-end submission of each form.

## License & ownership

See [LICENSE.md](LICENSE.md) for the ownership transfer terms and Alphatic's limited portfolio-reference right.

## Credits

**Author:** Alphatic

- **Aaleen Raza** — brand strategy, site structure, copywriting, and the site build, including the careers page.
- **Ali Salar** — the core EPIP product web application (the platform itself, separate from this marketing site).
