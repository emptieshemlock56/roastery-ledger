// Sends email through Resend (https://resend.com) when RESEND_API_KEY is set.
// Without a key, nothing is sent: help requests still appear on the Users page.

export function createMailer(config, { fetchImpl = fetch } = {}) {
  if (!config.resendApiKey) {
    return { enabled: false, async send() {} };
  }
  return {
    enabled: true,
    async send({ to, subject, text }) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text }),
      });
      if (!res.ok) throw new Error(`Email not sent: Resend answered ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
  };
}
