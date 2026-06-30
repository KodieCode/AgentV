// Outbound email — env-driven, best-effort. Cloud IPs are usually blocklisted,
// so mail always goes via a relay configured in .env (MAIL_PROVIDER + MAIL_API_KEY).
// If no relay is configured the call resolves as a no-op (logged) rather than
// throwing — completion notifications are nice-to-have, never load-bearing.
//
// Supported providers: brevo (HTTP API). Others fall through to a logged no-op
// so adding a provider is a localised change here, not a refactor of callers.

async function sendViaBrevo({ to, subject, html, text, from }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.MAIL_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: from },
      to: [{ email: to }],
      subject,
      ...(html ? { htmlContent: html } : { textContent: text || '' }),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`brevo_send_failed ${res.status}: ${body.slice(0, 300)}`);
  }
  return { ok: true };
}

async function sendMail({ to, subject, html, text, from }) {
  const provider = (process.env.MAIL_PROVIDER || '').toLowerCase();
  const recipient = to || process.env.ADMIN_NOTIFY_TO;
  const sender = from || process.env.MAIL_FROM;

  if (!recipient || !sender || !process.env.MAIL_API_KEY || !provider) {
    console.warn('sendMail: relay not configured (MAIL_*), skipping — subject:', subject);
    return { ok: false, skipped: true };
  }

  switch (provider) {
    case 'brevo':
      return sendViaBrevo({ to: recipient, subject, html, text, from: sender });
    default:
      // sendgrid / ses / smtp not wired in this extraction — log + skip so the
      // caller never fails on an unimplemented provider.
      console.warn(`sendMail: provider '${provider}' not implemented, skipping — subject: ${subject}`);
      return { ok: false, skipped: true };
  }
}

module.exports = { sendMail };
