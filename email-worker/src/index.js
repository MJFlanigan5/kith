import PostalMime from 'postal-mime';

export default {
  async email(message, env, ctx) {
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parsed = await new PostalMime().parse(rawEmail);

    const subject = parsed.subject || message.headers.get('subject') || '(no subject)';
    const from = message.from;
    const body = (parsed.text || parsed.html || '').slice(0, 5000);

    const icsAttachment = parsed.attachments?.find(a =>
      a.mimeType === 'text/calendar' || a.filename?.toLowerCase().endsWith('.ics')
    );
    const ics = icsAttachment
      ? new TextDecoder().decode(icsAttachment.content)
      : null;

    const res = await fetch(`${env.KITH_URL}/api/email/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kith-Secret': env.KITH_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ subject, from, body, ics }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kith webhook failed ${res.status}: ${text.slice(0, 200)}`);
    }
  },
};
