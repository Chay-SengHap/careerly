export function mailConfigured() {
  const env = process.env;
  return env.GMAIL_USER || env.GMAIL_APP_PASSWORD
    ? Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD)
    : Boolean(env.RESEND_API_KEY && env.PASSWORD_RESET_FROM);
}

export async function sendAccountEmail({ to, subject, text }) {
  const env = process.env;
  if (env.GMAIL_USER || env.GMAIL_APP_PASSWORD) {
    const { default: nodemailer } = await import("nodemailer");
    const mail = nodemailer.createTransport({
      service: "gmail",
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD.replace(/\s/g, "") },
      connectionTimeout: 10000,
      socketTimeout: 15000
    });
    await mail.sendMail({ from: { name: "Careerly", address: env.GMAIL_USER }, to, subject, text });
    return { ok: true };
  }
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.PASSWORD_RESET_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(8000)
  });
}
