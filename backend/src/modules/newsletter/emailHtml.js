/**
 * The email version of a newsletter edition: a clean, accessible HTML email
 * and its plain-text alternative.
 *
 *   - everything that came from a person or a feed is escaped (titles,
 *     summaries, organiser names, the school's name);
 *   - links are only the official https links already checked against the
 *     allowlist, the edition's page in EduOS and the unsubscribe page;
 *   - no tracking pixels, no remote images, no scripts; opens are counted
 *     only when someone opens the edition in EduOS;
 *   - no child's name: the email carries the shared core (hook, top five
 *     items, deadlines); personal matches are behind sign-in.
 */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Only https links survive; anything else becomes null (and is not rendered). */
export function safeHref(url) {
  try {
    const u = new URL(String(url ?? ''));
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null);

function whenText(o) {
  if (o.datesConfirmed && o.registrationCloses) return `Registration closes ${fmt(o.registrationCloses)}`;
  return o.typicalWindow ? `${o.typicalWindow} Check dates on the official site.` : 'Check dates on the official site.';
}

/**
 * @param {object} p
 * @param {string} p.schoolName
 * @param {object} p.edition   { title, periodLabel, hook: { text, question } }
 * @param {Array}  p.items     opportunities (top five are used)
 * @param {Array}  p.deadlines [{ title, closes }]
 * @param {string} p.editionUrl  absolute https link to the edition in EduOS (or a path)
 * @param {string} p.unsubscribeUrl
 * @returns {{ subject: string, html: string, text: string }}
 */
export function renderEditionEmail({ schoolName, edition, items = [], deadlines = [], editionUrl, unsubscribeUrl }) {
  const top = items.slice(0, 5);
  const subject = `${edition.title}${schoolName ? ` · ${schoolName}` : ''}`.slice(0, 150);
  const itemHtml = top.map((o) => {
    const href = safeHref(o.officialUrl);
    return `<tr><td style="padding:12px 0;border-top:1px solid #e5e7eb">
<p style="margin:0 0 4px;font-size:16px;font-weight:bold;color:#111827">${escapeHtml(o.title)}</p>
<p style="margin:0 0 4px;font-size:13px;color:#374151">${escapeHtml([o.typeLabel, o.levelLabel, o.organiser].filter(Boolean).join(' · '))}</p>
<p style="margin:0 0 6px;font-size:14px;color:#111827">${escapeHtml(o.summary)}</p>
<p style="margin:0;font-size:13px;color:#374151">${escapeHtml(whenText(o))}${href ? ` · <a href="${escapeHtml(href)}" style="color:#1d4ed8">Official site</a>` : ''}</p>
</td></tr>`;
  }).join('\n');
  const deadlineHtml = deadlines.length
    ? `<h2 style="font-size:16px;margin:24px 0 8px;color:#111827">Closing soon</h2><ul style="margin:0;padding-left:20px;font-size:14px;color:#111827">${deadlines.map((d) => `<li>${escapeHtml(d.title)}: ${escapeHtml(fmt(d.closes))}</li>`).join('')}</ul>`
    : '';
  const edHref = escapeHtml(editionUrl);
  const unHref = escapeHtml(unsubscribeUrl);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px"><tr><td style="padding:24px">
<p style="margin:0;font-size:13px;color:#374151">${escapeHtml(schoolName)} · ${escapeHtml(edition.periodLabel ?? '')}</p>
<h1 style="font-size:22px;margin:4px 0 16px;color:#111827">${escapeHtml(edition.title)}</h1>
<p style="margin:0 0 4px;font-size:17px;color:#111827">${escapeHtml(edition.hook?.text)}</p>
${edition.hook?.question ? `<p style="margin:0 0 16px;font-size:15px;font-style:italic;color:#374151">${escapeHtml(edition.hook.question)}</p>` : ''}
<p style="margin:0 0 16px"><a href="${edHref}" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:15px">Open the interactive edition: flashcards, quiz and your matches</a></p>
<h2 style="font-size:16px;margin:16px 0 0;color:#111827">This edition's top opportunities</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemHtml}</table>
${deadlineHtml}
<p style="margin:24px 0 0;font-size:12px;color:#4b5563">Dates marked "check" have not been confirmed by the school: always check the official site before you apply. You receive this because you turned on the newsletter email in EduOS. <a href="${unHref}" style="color:#1d4ed8">Unsubscribe</a>.</p>
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    `${schoolName} · ${edition.periodLabel ?? ''}`,
    edition.title,
    '',
    edition.hook?.text ?? '',
    edition.hook?.question ?? '',
    '',
    'Top opportunities:',
    ...top.map((o, i) => `${i + 1}. ${o.title} (${[o.typeLabel, o.levelLabel].filter(Boolean).join(', ')})\n   ${whenText(o)}${safeHref(o.officialUrl) ? `\n   Official site: ${safeHref(o.officialUrl)}` : ''}`),
    ...(deadlines.length ? ['', 'Closing soon:', ...deadlines.map((d) => `- ${d.title}: ${fmt(d.closes)}`)] : []),
    '',
    `Open the interactive edition (flashcards, quiz, your matches): ${editionUrl}`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n');
  return { subject, html, text };
}
