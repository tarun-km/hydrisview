/**
 * Transactional email templates in the Hydris brand. Every template returns a subject, a
 * plain-text body (always sent as the text alternative) and a self-contained HTML body
 * (inline styles, table layout, no external images) that renders in common mail clients.
 */
export interface MailContent { subject: string; text: string; html: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const BLUE = '#1954F1';
const INK = '#0B1220';
const MUTED = '#5B6577';

function layout(o: { preheader: string; heading: string; paragraphs: string[]; cta?: { label: string; url: string }; footnote?: string; tone?: 'default' | 'critical' }): string {
  const accent = o.tone === 'critical' ? '#D92D20' : BLUE;
  const ps = o.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${INK}">${p}</p>`).join('');
  const cta = o.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:999px;background:${accent}">
<a href="${esc(o.cta.url)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${esc(o.cta.label)}</a></td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${MUTED}">If the button does not work, copy this link into your browser:<br><a href="${esc(o.cta.url)}" style="color:${BLUE};word-break:break-all">${esc(o.cta.url)}</a></p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.heading)}</title></head>
<body style="margin:0;padding:0;background:#F3F5F9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:${accent};padding:22px 32px;font-size:20px;font-weight:700;letter-spacing:.2px;color:#ffffff">Hydris<span style="font-weight:400;opacity:.85"> · Field Glasses</span></td></tr>
<tr><td style="padding:32px">
<h1 style="margin:0 0 20px;font-size:24px;line-height:32px;color:${INK}">${esc(o.heading)}</h1>
${ps}${cta}
${o.footnote ? `<p style="margin:16px 0 0;font-size:13px;line-height:20px;color:${MUTED}">${o.footnote}</p>` : ''}
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #E6E9F0;font-size:12px;line-height:18px;color:${MUTED}">Hydris AI · Operational intelligence for wastewater teams. This is an automated message.</td></tr>
</table></td></tr></table></body></html>`;
}

export function inviteMail(o: { url: string; orgName: string; accountType: 'admin' | 'operator'; name?: string | null }): MailContent {
  const op = o.accountType === 'operator';
  const role = op ? 'a Field Operator' : 'an Administrator';
  const hello = o.name ? `Hello ${esc(o.name)},` : 'Hello,';
  return {
    subject: `You have been invited to ${o.orgName} on Hydris`,
    text: `${o.name ? `Hello ${o.name},` : 'Hello,'}\n\nYou have been invited to ${o.orgName} on Hydris as ${role}.\nSet your password within 7 days: ${o.url}\n\n${op ? 'Then install the Hydris Field app on your Android phone and sign in with this email.\n\n' : ''}If you were not expecting this, ignore this email.`,
    html: layout({
      preheader: `Join ${o.orgName} on Hydris`, heading: `Join ${o.orgName}`,
      paragraphs: [hello, `You have been invited to <b>${esc(o.orgName)}</b> on Hydris as ${role}.`, ...(op ? ['After setting your password you will be guided to install the <b>Hydris Field</b> app on your Android phone.'] : [])],
      cta: { label: 'Set your password', url: o.url }, footnote: 'The invitation expires in 7 days. If you were not expecting it, ignore this email.',
    }),
  };
}

export function passwordResetMail(o: { url: string }): MailContent {
  return {
    subject: 'Reset your Hydris password',
    text: `Use this link within 30 minutes to set a new password:\n${o.url}\n\nIf you did not request this, ignore this email.`,
    html: layout({ preheader: 'Reset your Hydris password', heading: 'Reset your password', paragraphs: ['Someone (hopefully you) asked to reset the password of your Hydris account.'], cta: { label: 'Choose a new password', url: o.url }, footnote: 'The link works once, for 30 minutes. If you did not request it, ignore this email; your password stays the same.' }),
  };
}

export function verifyEmailMail(o: { url: string; orgName?: string }): MailContent {
  return {
    subject: 'Confirm your Hydris administrator account',
    text: `Confirm your email to finish creating your Hydris organization:\n${o.url}\n\nThe link is valid for 24 hours. If you did not sign up, ignore this email.`,
    html: layout({ preheader: 'Confirm your email', heading: 'Confirm your email', paragraphs: [`Confirm your email to finish creating ${o.orgName ? `<b>${esc(o.orgName)}</b>` : 'your organization'} on Hydris. You will land in the console setup.`], cta: { label: 'Confirm email', url: o.url }, footnote: 'The link is valid for 24 hours. If you did not sign up, ignore this email.' }),
  };
}

export function magicLinkMail(o: { url: string }): MailContent {
  return {
    subject: 'Your Hydris sign-in link',
    text: `Use this link within 15 minutes to sign in to Hydris:\n${o.url}\n\nIf you did not request it, ignore this email.`,
    html: layout({ preheader: 'Your sign-in link', heading: 'Sign in to Hydris', paragraphs: ['Tap the button on the device where you want to sign in.'], cta: { label: 'Sign in', url: o.url }, footnote: 'The link works once, for 15 minutes. If you did not request it, ignore this email.' }),
  };
}

export function alarmEscalationMail(o: { title: string; severity: string; siteName?: string | null; assetTag?: string | null; url: string; raisedAt: Date }): MailContent {
  const where = [o.siteName, o.assetTag].filter(Boolean).join(' · ');
  return {
    subject: `[${o.severity.toUpperCase()}] ${o.title}`,
    text: `Alarm escalation: ${o.title}\nSeverity: ${o.severity}\n${where ? `Location: ${where}\n` : ''}Raised: ${o.raisedAt.toISOString()}\n\nOpen in the console: ${o.url}\n\nHydris is advisory only: follow your site procedures.`,
    html: layout({
      tone: 'critical', preheader: `${o.severity} alarm: ${o.title}`, heading: o.title,
      paragraphs: [`Severity: <b>${esc(o.severity)}</b>`, ...(where ? [`Location: ${esc(where)}`] : []), `Raised: ${esc(o.raisedAt.toUTCString())}`, 'This alarm has not been acknowledged in time and was escalated to you.'],
      cta: { label: 'Open the alarm', url: o.url }, footnote: 'Hydris is advisory only: follow your site procedures and permit-to-work rules.',
    }),
  };
}

export function accountEndedMail(o: { orgName: string; status: 'suspended' | 'removed'; name?: string | null }): MailContent {
  const suspended = o.status === 'suspended';
  const line = suspended
    ? `Your access to ${o.orgName} on Hydris has been suspended by an administrator. You have been signed out of the web, the Hydris Field app and your glasses.`
    : `Your access to ${o.orgName} on Hydris has been removed by an administrator. You have been signed out of the web, the Hydris Field app and your glasses.`;
  return {
    subject: suspended ? 'Your Hydris access is suspended' : 'Your Hydris access has been removed',
    text: `${o.name ? `Hello ${o.name},\n\n` : ''}${line}\n\nIf you think this is a mistake, contact your administrator.`,
    html: layout({ preheader: suspended ? 'Access suspended' : 'Access removed', heading: suspended ? 'Access suspended' : 'Access removed', paragraphs: [...(o.name ? [`Hello ${esc(o.name)},`] : []), esc(line), 'If you think this is a mistake, contact your administrator.'] }),
  };
}
