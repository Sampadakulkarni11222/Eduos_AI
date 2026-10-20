import { BoardMeeting } from '../../models/governance.model.js';
import { BoardPack } from '../../models/boardPack.model.js';
import { Budget } from '../../models/finance.model.js';
import { ApprovalRequest } from '../../models/approval.model.js';
import { Enrollment } from '../../models/student.model.js';
import { Profile } from '../../models/profile.model.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../utils/auditTrail.js';
import * as governance from '../governance/governance.service.js';
import * as compliance from '../compliance/compliance.service.js';
import { overview as analyticsOverview } from '../analytics/analytics.service.js';
import { valueText } from '../analytics/quarterly.service.js';
import { assertObjectId, optionalText } from '../ops/common.js';

/**
 * Board pack: everything a governing body needs to read before a meeting, in
 * one place, built from the school's own records:
 *
 *   meeting      agenda (with papers), members, quorum
 *   previous     the last held meeting of the same body: approved minutes and
 *                resolutions
 *   actions      the open action register, overdue first
 *   finance      fee collections, outstanding and budget use this financial
 *                year (the analytics workspace's own figures and definitions)
 *   budget       the current year's budget by line, with utilisation
 *   compliance   overdue and next-30-day statutory items (affiliation,
 *                UDISE+, licences, returns, trainings)
 *   decisions    approval requests waiting for a trustee
 *   enrolment    students on roll
 *   questions    questions a member might ask, each tied to the figure that
 *                prompted it (rules over the numbers, not a model; labelled)
 *
 * Every section is built only if the person building the pack may read that
 * data; otherwise it says so. The secretariat (governance.manage) freezes a
 * version to circulate it; members then read the frozen version (the same
 * papers for everyone) and each open is recorded as a read receipt. Nothing
 * here decides anything: trustees vote in the meeting.
 */

const DAY = 86_400_000;
const has = (actor, key) => Boolean(actor?.permissions?.[key]);
const fyOf = (d) => { const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; };
const unavailable = (reason) => ({ available: false, reason });

async function safe(fn) {
  try { return await fn(); } catch (err) { return unavailable(err?.message ? `Could not be built: ${err.message}` : 'Could not be built.'); }
}

async function previousMeeting(m) {
  const before = m.scheduledAt ?? m.createdAt ?? new Date();
  const prev = await BoardMeeting.findOne({ _id: { $ne: m._id ?? m.id }, body: m.body, status: 'HELD', scheduledAt: { $lt: before } }).sort({ scheduledAt: -1 }).select('refNo title scheduledAt minutes resolutions actions').lean();
  if (!prev) return unavailable('No earlier held meeting of this body.');
  return {
    available: true, id: String(prev._id), refNo: prev.refNo, title: prev.title, heldOn: prev.scheduledAt,
    minutesStatus: prev.minutes?.status ?? 'NONE',
    minutes: prev.minutes?.status === 'APPROVED' ? prev.minutes.body : null,
    minutesNote: prev.minutes?.status === 'APPROVED' ? null : 'The minutes of that meeting are not approved yet; confirm them at this meeting.',
    resolutions: (prev.resolutions ?? []).map((r) => ({ number: r.number, text: r.text, outcome: r.outcome, votesFor: r.votesFor, votesAgainst: r.votesAgainst, abstentions: r.abstentions })),
  };
}

async function financeSection(actor) {
  const scope = actor.permissions?.['analytics.workspace.read'];
  if (!scope) return unavailable('Finance figures need access to the analytics workspace.');
  const data = await analyticsOverview(actor, scope, { department: 'finance', preset: 'financialYear', compare: 'lastYear' });
  const pick = ['finance.net_collections', 'finance.billed', 'finance.outstanding', 'finance.concessions', 'finance.refunds', 'finance.budget_utilisation', 'finance.cost_per_student'];
  const metrics = data.metrics.filter((m) => pick.includes(m.key)).map((m) => ({
    key: m.key, label: m.label, unit: m.unit,
    value: m.current?.value ?? null, text: valueText(m.current?.value ?? null, m.unit, data.currency),
    comparison: m.comparison?.value ?? null, comparisonText: m.comparison ? valueText(m.comparison.value, m.unit, data.currency) : null,
    changePct: m.change?.comparable ? m.change.pct : null, definition: m.definition,
  }));
  return { available: true, period: data.period, comparison: data.comparison, currency: data.currency, metrics, note: 'Billing is counted on the invoice date and cash on the payment date; the two are never mixed. Definitions are those of the analytics workspace.' };
}

async function budgetSection(actor, now) {
  if (!has(actor, 'budget.read')) return unavailable('The budget needs budget access.');
  const fy = fyOf(now);
  const b = await Budget.findOne({ fiscalYear: fy }).sort({ createdAt: -1 }).lean();
  if (!b) return unavailable(`No budget recorded for ${fy}.`);
  const lines = (b.lines ?? []).map((l) => ({
    code: l.code, head: l.head, kind: l.kind, plannedPaise: l.plannedPaise, committedPaise: l.committedPaise ?? 0, actualPaise: l.actualPaise ?? 0,
    utilisationPct: l.plannedPaise ? Math.round((((l.actualPaise ?? 0) + (l.committedPaise ?? 0)) / l.plannedPaise) * 100) : null,
    varianceExplanation: l.varianceExplanation ?? null,
  }));
  const totals = lines.reduce((t, l) => ({ planned: t.planned + l.plannedPaise, committed: t.committed + l.committedPaise, actual: t.actual + l.actualPaise }), { planned: 0, committed: 0, actual: 0 });
  const elapsedPct = Math.round(Math.min(1, Math.max(0, (now - new Date(Date.UTC(Number(fy.slice(0, 4)), 3, 1))) / (365 * DAY))) * 100);
  // Last year's outturn: planned against actual, and the lines that overran.
  const prevFy = `${Number(fy.slice(0, 4)) - 1}-${fy.slice(2, 4)}`;
  const pb = await Budget.findOne({ fiscalYear: prevFy, status: 'APPROVED' }).sort({ createdAt: -1 }).lean();
  const previousYear = pb ? {
    fiscalYear: prevFy,
    planned: (pb.lines ?? []).reduce((t, l) => t + (l.plannedPaise ?? 0), 0),
    actual: (pb.lines ?? []).reduce((t, l) => t + (l.actualPaise ?? 0), 0),
    overruns: (pb.lines ?? []).filter((l) => (l.actualPaise ?? 0) > (l.plannedPaise ?? 0)).map((l) => ({ code: l.code, head: l.head, plannedPaise: l.plannedPaise, actualPaise: l.actualPaise, overPct: l.plannedPaise ? Math.round(((l.actualPaise - l.plannedPaise) / l.plannedPaise) * 100) : null, explanation: l.varianceExplanation ?? null })),
  } : null;
  return { available: true, fiscalYear: fy, name: b.name, status: b.status, lines, totals, yearElapsedPct: elapsedPct, previousYear };
}

async function complianceSection(actor) {
  if (!has(actor, 'compliance.read')) return unavailable('Compliance items need compliance access.');
  const items = await compliance.calendar({ days: 30 });
  const ov = await compliance.overview();
  return {
    available: true,
    overdue: items.filter((i) => i.overdue).map((i) => ({ kind: i.kind, title: i.title, date: i.renewBy ?? i.date, status: i.status })),
    dueIn30Days: items.filter((i) => !i.overdue).map((i) => ({ kind: i.kind, title: i.title, date: i.renewBy ?? i.date, status: i.status })),
    counts: { returnsOverdue: ov.returnsOverdue, licencesExpired: ov.licencesExpired, licencesExpiring: ov.licencesExpiring, policiesReviewOverdue: ov.policiesReviewOverdue, noticesToReview: ov.noticesToReview },
  };
}

async function decisionsSection(actor) {
  if (!has(actor, 'approvals.read')) return unavailable('Approvals need approvals access.');
  const rows = await ApprovalRequest.find({ status: 'PENDING' }).select('refNo title category amountPaise dueAt stages currentStage').lean();
  const forBoard = rows.filter((r) => r.stages?.[r.currentStage]?.approverRole === 'TRUSTEE');
  return {
    available: true,
    items: forBoard.map((r) => ({ id: String(r._id), refNo: r.refNo, title: r.title, category: r.category, amountPaise: r.amountPaise, dueAt: r.dueAt, stage: r.stages[r.currentStage]?.name })),
    note: 'Requests whose current stage is a trustee decision. Each is decided by the trustee on the Approvals page, never from the pack.',
  };
}

/** Questions a member might ask, each from a figure in the pack. Rules, not a model. */
export function suggestQuestions(pack) {
  const q = [];
  const add = (question, basis, section) => q.push({ question, basis, section });
  const overdueActions = (pack.actions?.items ?? []).filter((a) => a.overdue);
  if (overdueActions.length) add(`What is blocking ${overdueActions.length === 1 ? `"${overdueActions[0].title}"` : `the ${overdueActions.length} overdue actions`}, and what is the new date?`, `${overdueActions.length} action${overdueActions.length === 1 ? '' : 's'} past the due date in the action register.`, 'actions');
  const c = pack.compliance;
  if (c?.available && c.overdue.length) add(`Which overdue statutory item carries a penalty or affects affiliation, and who owns each?`, `${c.overdue.length} compliance item${c.overdue.length === 1 ? ' is' : 's are'} overdue (for example "${c.overdue[0].title}").`, 'compliance');
  if (c?.available && c.counts.licencesExpired) add('Are we operating any service whose licence or certificate has expired?', `${c.counts.licencesExpired} licence${c.counts.licencesExpired === 1 ? '' : 's'} recorded as expired.`, 'compliance');
  const b = pack.budget;
  if (b?.available) {
    for (const l of b.lines.filter((x) => b.status === 'APPROVED' && x.utilisationPct !== null && x.utilisationPct > Math.max(90, b.yearElapsedPct + 25)).slice(0, 3)) {
      add(`Why is "${l.head}" already ${l.utilisationPct}% used with ${100 - b.yearElapsedPct}% of the year to go?`, `Budget line ${l.code}: ${l.utilisationPct}% committed or spent; ${b.yearElapsedPct}% of the year elapsed.`, 'budget');
    }
    if (b.status !== 'APPROVED') add(`When will the ${b.fiscalYear} budget be approved, and what spending rules apply until then?`, `The ${b.fiscalYear} budget is ${String(b.status).toLowerCase().replace(/_/g, ' ')}, ${b.yearElapsedPct}% into the year.`, 'budget');
    for (const o of (b.previousYear?.overruns ?? []).filter((x) => x.overPct >= 10 && !x.explanation).slice(0, 2)) add(`Why did "${o.head}" overrun by ${o.overPct}% in ${b.previousYear.fiscalYear}, and is it budgeted properly this year?`, `${b.previousYear.fiscalYear} line ${o.code}: planned against actual, no variance explanation recorded.`, 'budget');
    if (b.status === 'APPROVED' && b.totals.planned && b.totals.actual + b.totals.committed === 0 && b.yearElapsedPct > 25) add('Is spending being recorded against the budget lines?', `Nothing is committed or spent against the ${b.fiscalYear} budget, ${b.yearElapsedPct}% into the year.`, 'budget');
  }
  const f = pack.finance;
  if (f?.available) {
    const out = f.metrics.find((m) => m.key === 'finance.outstanding');
    const net = f.metrics.find((m) => m.key === 'finance.net_collections');
    if (out?.value && net?.value && out.value > net.value * 0.25) add('What is the plan to recover outstanding fees, and how much is more than 90 days old?', `Outstanding fees ${out.text} against net collections of ${net.text} this financial year.`, 'finance');
    if (net?.changePct !== null && net?.changePct !== undefined && net.changePct < -10) add('Why are fee collections lower than the same period last year?', `Net collections ${net.changePct}% against last year.`, 'finance');
  }
  const p = pack.previous;
  if (p?.available && p.minutesStatus !== 'APPROVED') add(`Can the minutes of ${p.refNo} be confirmed today?`, 'The previous meeting\'s minutes are not approved yet.', 'previous');
  const d = pack.decisions;
  if (d?.available && d.items.length) add(`Do we have what we need to decide the ${d.items.length} request${d.items.length === 1 ? '' : 's'} waiting for the board?`, `${d.items.length} approval request${d.items.length === 1 ? '' : 's'} at a trustee stage.`, 'decisions');
  return q.slice(0, 10);
}

/** Builds the pack live from the records, as this person may see them. */
export async function buildPack(actor, scope, meetingId, now = new Date()) {
  const meeting = await governance.get(actor, scope, meetingId);
  const [previous, actions, finance, budget, comp, decisions, onRoll] = await Promise.all([
    safe(() => previousMeeting(meeting)),
    safe(async () => {
      const rows = await governance.openActions(actor, scope);
      return { available: true, items: rows.sort((a, b) => Number(b.overdue) - Number(a.overdue)) };
    }),
    safe(() => financeSection(actor)),
    safe(() => budgetSection(actor, now)),
    safe(() => complianceSection(actor)),
    safe(() => decisionsSection(actor)),
    safe(async () => Enrollment.countDocuments({ status: 'ACTIVE' })),
  ]);
  const pack = {
    meeting: {
      id: meeting.id, refNo: meeting.refNo, title: meeting.title, body: meeting.body, status: meeting.status, scheduledAt: meeting.scheduledAt,
      mode: meeting.mode, location: meeting.location, quorum: meeting.quorum, agendaStatus: meeting.agendaStatus,
      agenda: (meeting.agenda ?? []).map((a) => ({ order: a.order, title: a.title, presenter: a.presenter ?? null, decisionNeeded: Boolean(a.decisionNeeded), papers: (a.papers ?? []).map((p) => ({ name: p.name ?? p.label ?? 'Paper', url: p.url ?? null })) })),
      members: (meeting.members ?? []).map((x) => ({ name: x.name, role: x.role, voting: x.voting, rsvp: x.rsvp, conflicts: (x.conflicts ?? []).map((c) => ({ agendaOrder: c.agendaOrder, declaration: c.declaration })) })),
    },
    previous, actions, finance, budget, compliance: comp, decisions,
    enrolment: typeof onRoll === 'number' ? { available: true, studentsOnRoll: onRoll } : onRoll,
    builtAt: now.toISOString(),
  };
  pack.questions = suggestQuestions(pack);
  pack.questionsNote = 'Suggested from the figures in this pack by fixed rules; each shows the figure behind it. They are prompts for discussion, not findings.';
  return pack;
}

function summary(p) {
  return p ? { version: p.version, frozenAt: p.createdAt, frozenBy: p.frozenByName, note: p.note, reads: (p.reads ?? []).map((r) => ({ name: r.name, at: r.at })) } : null;
}

/**
 * The pack a member reads: the latest frozen version if there is one (and an
 * open records a read receipt), otherwise a live preview built for this
 * person. The secretariat can ask for the live view even after freezing.
 */
export async function getPack(actor, scope, meetingId, { live = false, now = new Date() } = {}) {
  await governance.get(actor, scope, meetingId); // membership check
  const frozen = await BoardPack.findOne({ meetingId: assertObjectId(meetingId) }).sort({ version: -1 });
  const versions = await BoardPack.find({ meetingId }).sort({ version: -1 }).select('version createdAt frozenByName note').lean();
  if (frozen && !(live && has(actor, 'governance.manage'))) {
    if (!(frozen.reads ?? []).some((r) => String(r.profileId) === String(actor.profileId))) {
      const me = await Profile.findById(actor.profileId).select('displayName').lean();
      await BoardPack.updateOne({ _id: frozen._id, 'reads.profileId': { $ne: actor.profileId } }, { $push: { reads: { profileId: actor.profileId, name: me?.displayName ?? 'Member', at: now } } });
      frozen.reads.push({ profileId: actor.profileId, name: me?.displayName ?? 'Member', at: now });
    }
    return { mode: 'FROZEN', ...summary(frozen.toObject()), versions: versions.map((v) => ({ version: v.version, frozenAt: v.createdAt, frozenBy: v.frozenByName, note: v.note })), pack: frozen.data };
  }
  return { mode: 'LIVE', version: null, versions: versions.map((v) => ({ version: v.version, frozenAt: v.createdAt, frozenBy: v.frozenByName, note: v.note })), pack: await buildPack(actor, scope, meetingId, now) };
}

/** Freezes the current figures as a new version, for circulation (secretariat only). */
export async function freezePack(actor, meetingId, body = {}, now = new Date()) {
  if (!has(actor, 'governance.manage')) throw new AppError('Only the secretariat freezes a board pack.', 403);
  const meeting = await governance.get(actor, 'ALL', meetingId);
  if (meeting.status === 'CANCELLED') throw new AppError('This meeting was cancelled.', 409, [], 'MEETING_CANCELLED');
  const data = await buildPack(actor, 'ALL', meetingId, now);
  const last = await BoardPack.findOne({ meetingId }).sort({ version: -1 }).select('version').lean();
  const me = await Profile.findById(actor.profileId).select('displayName').lean();
  const version = (last?.version ?? 0) + 1;
  let doc;
  try {
    doc = await BoardPack.create({ meetingId, version, data, frozenByProfileId: actor.profileId, frozenByName: me?.displayName ?? null, note: optionalText(body.note, { max: 500 }) || null, reads: [] });
  } catch (err) {
    if (err?.code === 11000) throw new AppError('Someone froze a version at the same moment. Refresh and try again.', 409, [], 'PACK_CONFLICT');
    throw err;
  }
  await recordAudit({ actor, action: 'governance.board_pack.freeze', entityType: 'BoardMeeting', entityId: meetingId, after: { version } });
  return { mode: 'FROZEN', ...summary(doc.toObject()), pack: data };
}
