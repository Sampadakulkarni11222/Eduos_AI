import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { generate, isLlmEnabled } from '../../providers/ai.provider.js';

/**
 * AI drafts: letters, circular text, meeting minutes from notes, lesson-plan
 * outlines and report-card remarks.
 *
 * A draft is text handed back to the person who asked. It is never sent,
 * published or saved into any record here; they copy it, edit it and save it
 * through the normal screen, where the normal permissions and approvals apply.
 *
 * With a model configured (providers/ai.provider.js) the draft comes from the
 * model; without one it comes from a deterministic template and says so.
 * What reaches the model is cut down first:
 *  - only the fields each kind of draft needs are read from the request;
 *  - phone numbers, email addresses and ID numbers are removed from free text;
 *  - any sentence about health, medical, safeguarding or similar restricted
 *    matters is removed and replaced with a marker;
 *  - a report-card remark gets only subject marks bands and the attendance
 *    percentage, never the pupil's name (it is put back in afterwards).
 */

export const DRAFT_KINDS = ['LETTER', 'CIRCULAR', 'MINUTES', 'LESSON_PLAN', 'REPORT_REMARK'];
export const TEMPLATE_LABEL = 'Template draft (no AI key configured)';
export const TEMPLATE_FALLBACK_LABEL = 'Template draft (the AI service did not answer)';
export const AI_LABEL = 'AI draft: review and edit before you use it';
export const BANDS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'E', 'EXCELLENT', 'VERY_GOOD', 'GOOD', 'SATISFACTORY', 'NEEDS_IMPROVEMENT'];

const RESTRICTED_RE = /\b(diagnos\w*|medical\w*|medicine\w*|medication\w*|allerg\w*|asthma\w*|epilep\w*|seizure\w*|diabet\w*|illness\w*|disab\w*|autis\w*|adhd|dyslex\w*|therap\w*|counsell?\w*|psychiatr\w*|psycholog\w*|safeguard\w*|abuse\w*|abusive|neglect\w*|pocso|self[- ]?harm\w*|suicid\w*|injur\w*|hospital\w*|pregnan\w*|mental health|health condition|blood group|hiv|custody|police complaint)\b/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const AADHAAR_RE = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
const PHONE_RE = /(?:\+\d{1,3}[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b|\+\d{10,14}\b/g;
export const REDACTED = '[restricted detail removed]';

/** Removes restricted sentences and contact/ID numbers from free text. Returns { text, removed }. */
export function redactForModel(input) {
  let removed = 0;
  // Contact and ID numbers first: an email address has full stops that would otherwise split it as a sentence.
  const scrubbed = String(input ?? '')
    .replace(EMAIL_RE, () => { removed += 1; return '[email removed]'; })
    .replace(AADHAAR_RE, () => { removed += 1; return '[ID number removed]'; })
    .replace(PHONE_RE, () => { removed += 1; return '[phone removed]'; });
  // Split after each sentence end or line break, keeping the spacing, so line structure survives.
  const kept = scrubbed.split(/(?<=[.!?\n])/).map((s) => {
    if (RESTRICTED_RE.test(s)) { removed += 1; return `${s.match(/^\s*/)[0]}${REDACTED}${s.endsWith('\n') ? '\n' : ''}`; }
    return s;
  }).join('');
  return { text: kept.replace(/[ \t]+/g, ' ').trim(), removed };
}

const field = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const list = (v, maxItems = 20, max = 300) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : []).map((x) => field(x, max)).filter(Boolean).slice(0, maxItems);

/** The only inputs each kind reads. Anything else in the request is ignored. */
function inputsFor(kind, body) {
  switch (kind) {
    case 'LETTER': return { recipient: field(body.recipient, 200), subject: field(body.subject, 200), purpose: field(body.purpose, 3000), points: list(body.points), tone: field(body.tone, 20).toUpperCase() === 'WARM' ? 'WARM' : 'FORMAL', signOff: field(body.signOff, 120) };
    case 'CIRCULAR': return { title: field(body.title, 200), audience: field(body.audience, 200), date: field(body.date, 40), details: field(body.details, 4000), actionRequired: field(body.actionRequired, 1000) };
    case 'MINUTES': return { meetingTitle: field(body.meetingTitle, 200), date: field(body.date, 40), attendees: field(body.attendees, 1000), notes: field(body.notes, 8000) };
    case 'LESSON_PLAN': return { subject: field(body.subject, 100), grade: field(body.grade, 60), topic: field(body.topic, 200), durationMinutes: Math.max(10, Math.min(Number.parseInt(body.durationMinutes, 10) || 40, 240)), objectives: list(body.objectives, 10) };
    case 'REPORT_REMARK': {
      const bands = (Array.isArray(body.bands) ? body.bands : []).slice(0, 15).map((b) => ({ subject: field(b?.subject, 60), band: field(b?.band, 20).toUpperCase().replace(/\s+/g, '_') }))
        .filter((b) => b.subject && BANDS.includes(b.band));
      const att = Number(body.attendancePct);
      return { bands, attendancePct: Number.isFinite(att) && att >= 0 && att <= 100 ? Math.round(att) : null, firstName: field(body.studentFirstName, 40) };
    }
    default: throw new AppError(`kind must be one of ${DRAFT_KINDS.join(', ')}`, 400, [], 'BAD_KIND');
  }
}

/** Free-text inputs are redacted before they go anywhere (model or template). */
function redactInputs(kind, inp) {
  let removed = 0;
  const r = (t) => { const out = redactForModel(t); removed += out.removed; return out.text; };
  const out = { ...inp };
  for (const k of ['recipient', 'subject', 'purpose', 'signOff', 'title', 'audience', 'details', 'actionRequired', 'meetingTitle', 'attendees', 'notes', 'topic']) if (typeof out[k] === 'string') out[k] = r(out[k]);
  for (const k of ['points', 'objectives']) if (Array.isArray(out[k])) out[k] = out[k].map(r);
  if (kind === 'REPORT_REMARK') delete out.firstName; // the model never sees the pupil's name
  return { inputs: out, removed };
}

const BAND_WORD = { A1: 'outstanding', A2: 'excellent', B1: 'very good', B2: 'good', C1: 'satisfactory', C2: 'fair', D: 'developing', E: 'needs support', EXCELLENT: 'excellent', VERY_GOOD: 'very good', GOOD: 'good', SATISFACTORY: 'satisfactory', NEEDS_IMPROVEMENT: 'needs support' };
const STRONG = new Set(['A1', 'A2', 'B1', 'EXCELLENT', 'VERY_GOOD']);
const WEAK = new Set(['D', 'E', 'C2', 'NEEDS_IMPROVEMENT']);

export function templateDraft(kind, i, { firstName = '' } = {}) {
  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric' });
  switch (kind) {
    case 'LETTER': return [
      today, '', i.recipient ? `To ${i.recipient},` : 'To whom it may concern,', '', i.subject ? `Subject: ${i.subject}` : null, '',
      i.tone === 'WARM' ? 'I hope this finds you well.' : 'Greetings from the school.',
      i.purpose || '[State the purpose of the letter.]',
      ...(i.points.length ? ['', ...i.points.map((p) => `• ${p}`)] : []),
      '', 'Please contact the school office if you have any questions.', '', i.tone === 'WARM' ? 'Warm regards,' : 'Yours sincerely,', i.signOff || '[Name and designation]',
    ].filter((l) => l !== null).join('\n');
    case 'CIRCULAR': return [
      `CIRCULAR${i.date ? ` · ${i.date}` : ''}`, i.title ? i.title.toUpperCase() : '[TITLE]', i.audience ? `For: ${i.audience}` : 'For: [audience]', '',
      i.details || '[Details: what is happening, when and where.]', '', i.actionRequired ? `Action required: ${i.actionRequired}` : 'Action required: [what families or staff need to do, and by when].', '', 'Principal',
    ].join('\n');
    case 'MINUTES': {
      const points = i.notes.split(/\n+|(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
      const actions = points.filter((p) => /\b(action|will|to do|by \w+day|deadline|follow up|responsible)\b/i.test(p));
      return [
        `Minutes: ${i.meetingTitle || '[Meeting]'}`, `Date: ${i.date || today}`, `Present: ${i.attendees || '[names]'}`, '',
        'Discussion', ...points.map((p, n) => `${n + 1}. ${p}`), '',
        'Actions agreed', ...(actions.length ? actions.map((a) => `• ${a}`) : ['• [Owner, action, due date]']), '',
        'Minutes recorded by: [name]. To be confirmed at the next meeting.',
      ].join('\n');
    }
    case 'LESSON_PLAN': {
      const d = i.durationMinutes;
      const parts = [['Warm-up and recall', Math.round(d * 0.15)], ['Introduce the idea', Math.round(d * 0.25)], ['Guided practice', Math.round(d * 0.3)], ['Independent work', Math.round(d * 0.2)]];
      const used = parts.reduce((s, [, m]) => s + m, 0);
      return [
        `Lesson plan outline: ${i.topic || '[topic]'}`, `${i.subject || '[Subject]'} · ${i.grade || '[Class]'} · ${d} minutes`, '',
        'Learning objectives', ...(i.objectives.length ? i.objectives.map((o) => `• ${o}`) : ['• [What pupils will know or be able to do]']), '',
        'Sequence', ...parts.map(([t, m]) => `• ${t} (${m} min)`), `• Check for understanding and wrap-up (${d - used} min)`, '',
        'Resources: [textbook pages, materials]', 'Assessment: [exit question or short task]', 'Differentiation: [support and stretch]',
      ].join('\n');
    }
    case 'REPORT_REMARK': {
      const name = firstName || 'The student';
      const strong = i.bands.filter((b) => STRONG.has(b.band)).map((b) => b.subject);
      const weak = i.bands.filter((b) => WEAK.has(b.band)).map((b) => b.subject);
      const s = [];
      if (strong.length) s.push(`${name} has done very well in ${strong.join(', ')}.`);
      else if (i.bands.length) s.push(`${name} has worked steadily this term${i.bands[0] ? `, with ${BAND_WORD[i.bands[0].band]} work in ${i.bands[0].subject}` : ''}.`);
      else s.push(`${name} has worked steadily this term.`);
      if (weak.length) s.push(`More regular practice in ${weak.join(', ')} will help build confidence.`);
      if (i.attendancePct !== null) s.push(i.attendancePct >= 90 ? 'Attendance has been excellent.' : i.attendancePct >= 75 ? 'Attendance has been regular.' : 'More regular attendance will help keep up with lessons.');
      s.push('Keep up the effort next term.');
      return s.join(' ');
    }
    default: return '';
  }
}

const SYSTEM = 'You draft documents for staff at a school in India. Write in clear, plain British English, polite and concise. '
  + 'Never invent facts, names, dates or figures that are not in the input; leave a [placeholder] instead. '
  + 'Never mention health, medical, safeguarding or disciplinary matters. Text marked [restricted detail removed] must not be guessed at. '
  + 'Return only the draft text, no preamble.';

function promptFor(kind, i) {
  switch (kind) {
    case 'LETTER': return `Draft a ${i.tone === 'WARM' ? 'warm but professional' : 'formal'} letter.\nTo: ${i.recipient || '[recipient]'}\nSubject: ${i.subject || '[subject]'}\nPurpose: ${i.purpose}\nPoints to include:\n${i.points.map((p) => `- ${p}`).join('\n')}\nSign off as: ${i.signOff || '[name and designation]'}`;
    case 'CIRCULAR': return `Draft a school circular.\nTitle: ${i.title}\nAudience: ${i.audience}\nDate: ${i.date}\nDetails: ${i.details}\nAction required: ${i.actionRequired}`;
    case 'MINUTES': return `Turn these meeting notes into formal minutes with sections for attendance, discussion points and actions agreed (owner and due date where given).\nMeeting: ${i.meetingTitle}\nDate: ${i.date}\nAttendees: ${i.attendees}\nNotes:\n${i.notes}`;
    case 'LESSON_PLAN': return `Draft a lesson-plan outline.\nSubject: ${i.subject}\nClass: ${i.grade}\nTopic: ${i.topic}\nDuration: ${i.durationMinutes} minutes\nObjectives:\n${i.objectives.map((o) => `- ${o}`).join('\n')}\nInclude timings, activities, resources, assessment and differentiation.`;
    case 'REPORT_REMARK': return `Write a 2-3 sentence report-card remark for a pupil, referring to them only as "the student". Encouraging and specific, no clichés.\nSubject bands: ${i.bands.map((b) => `${b.subject}: ${b.band}`).join('; ') || 'not given'}\nAttendance: ${i.attendancePct === null ? 'not given' : `${i.attendancePct}%`}`;
    default: return '';
  }
}

// The model call, replaceable in tests so the exact text sent can be checked.
let modelCall = (args) => generate(args);
let modelEnabled = () => isLlmEnabled();
export function setDraftModelForTests({ call, enabled } = {}) {
  modelCall = call ?? ((args) => generate(args));
  modelEnabled = enabled ?? (() => isLlmEnabled());
}

const NOTE = 'Nothing has been sent, published or saved. Copy the text, edit it, and save it in the screen where it will be used.';

/**
 * What a draft is based on: only what the person typed into the form (and
 * how much was removed before the model saw it). A draft never draws on
 * records it was not given, so this is its complete evidence.
 */
export function basedOn(kind, i, removed = 0) {
  const items = [];
  const add = (label, v) => { if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) items.push({ label, value: Array.isArray(v) ? v.join(', ') : String(v).slice(0, 160) }); };
  if (kind === 'REPORT_REMARK') { add('Marks bands you entered', i.bands); add('Attendance you entered', i.attendancePct === null ? null : `${i.attendancePct}%`); }
  if (kind === 'LETTER') { add('Recipient', i.recipient); add('Subject', i.subject); add('Purpose you wrote', i.purpose); add('Points you listed', i.points?.length ? `${i.points.length} point(s)` : null); }
  if (kind === 'CIRCULAR') { add('Title', i.title); add('Audience', i.audience); add('Date', i.date); add('Details you wrote', i.details ? `${i.details.length} characters` : null); }
  if (kind === 'MINUTES') { add('Meeting', i.meetingTitle); add('Date', i.date); add('Notes you pasted', i.notes ? `${i.notes.length} characters` : null); }
  if (kind === 'LESSON_PLAN') { add('Subject', i.subject); add('Class', i.grade); add('Topic', i.topic); add('Objectives you listed', i.objectives?.length ? `${i.objectives.length}` : null); }
  return { source: 'Only what you entered in this form; no school records were read.', items, redactedCount: removed };
}

export async function draft(actor, body = {}) {
  if (!actor?.profileId && !actor?.system) throw new AppError('Select a profile first', 403);
  const kind = String(body?.kind ?? '').toUpperCase();
  if (!DRAFT_KINDS.includes(kind)) throw new AppError(`kind must be one of ${DRAFT_KINDS.join(', ')}`, 400, [], 'BAD_KIND');
  const raw = inputsFor(kind, body ?? {});
  const empty = kind === 'MINUTES' ? !raw.notes : kind === 'REPORT_REMARK' ? !raw.bands.length && raw.attendancePct === null : kind === 'LESSON_PLAN' ? !raw.topic : kind === 'LETTER' ? !raw.purpose && !raw.points.length : !raw.details && !raw.title;
  if (empty) throw new AppError('Give a little to work from (the notes, the topic, the purpose or the marks bands).', 400, [], 'NOTHING_TO_DRAFT');
  const { inputs, removed } = redactInputs(kind, raw);
  const firstName = kind === 'REPORT_REMARK' ? raw.firstName : '';
  const base = { kind, redactions: removed, saved: false, note: NOTE, basedOn: basedOn(kind, raw, removed) };

  if (modelEnabled()) {
    try {
      const out = await modelCall({ system: SYSTEM, message: promptFor(kind, inputs), maxTokens: 1500 });
      if (out?.generated && out.text) {
        let text = String(out.text).trim();
        if (firstName) text = text.replace(/\bthe student\b/g, firstName).replace(/\bThe student\b/g, firstName);
        return { ...base, text, source: 'AI', label: AI_LABEL };
      }
    } catch (err) {
      logger.warn(`AI draft fell back to a template: ${err.message}`);
    }
    return { ...base, text: templateDraft(kind, inputs, { firstName }), source: 'TEMPLATE', label: TEMPLATE_FALLBACK_LABEL };
  }
  return { ...base, text: templateDraft(kind, inputs, { firstName }), source: 'TEMPLATE', label: TEMPLATE_LABEL };
}

export function status() {
  return { aiConfigured: isLlmEnabled(), kinds: DRAFT_KINDS, bands: BANDS, label: isLlmEnabled() ? AI_LABEL : TEMPLATE_LABEL };
}
