import { SafeguardingCase } from '../../models/compliance.model.js';
import { AppError } from '../../utils/AppError.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { recordAudit } from '../../utils/auditTrail.js';
import { sendOperational } from '../messaging/messaging.service.js';
import { Role } from '../../models/role.model.js';
import { Profile } from '../../models/profile.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import {
  nextRef, requireProfile, assertObjectId, assertTransition, pushHistory, parseDate, requireText, optionalText, oneOf,
} from '../ops/common.js';

/**
 * Safeguarding concerns (child protection, workplace sexual harassment,
 * ragging, bullying, online safety, self-harm risk).
 *
 * Who sees what:
 *   - the reporter sees their own report's reference and status, nothing else;
 *   - designated officers (safeguarding.manage) see and handle cases;
 *   - nobody else, through any path: the case is not in notifications (officers
 *     get a content-free alert), dashboards, search, the newsroom, the campus
 *     map or the assistant.
 *
 * Statutory reporting: where the law requires a report to an outside authority
 * (POCSO s.19 — Special Juvenile Police Unit or local police), the officer
 * records it here. Nothing in the system makes that report wait for an
 * internal approval; the UI tells the reporter so at the point of reporting.
 */

const CATEGORIES = ['CHILD_PROTECTION', 'SEXUAL_HARASSMENT_WORKPLACE', 'RAGGING', 'BULLYING', 'ONLINE_SAFETY', 'SELF_HARM_RISK', 'NEGLECT', 'OTHER'];
const MACHINE = {
  REPORTED: ['UNDER_REVIEW', 'REFERRED_EXTERNAL', 'CLOSED'],
  UNDER_REVIEW: ['REFERRED_EXTERNAL', 'ACTION_TAKEN', 'CLOSED'],
  REFERRED_EXTERNAL: ['UNDER_REVIEW', 'ACTION_TAKEN', 'CLOSED'],
  ACTION_TAKEN: ['UNDER_REVIEW', 'CLOSED'],
  CLOSED: ['UNDER_REVIEW'],
};

export const STATUTORY_GUIDANCE = {
  CHILD_PROTECTION: 'If a child may have been sexually abused, the law (POCSO Act s.19) requires a report to the Special Juvenile Police Unit or the local police. Do not wait for an internal decision. In immediate danger call 112; Childline 1098.',
  SEXUAL_HARASSMENT_WORKPLACE: 'Complaints of sexual harassment at the workplace are handled by the Internal Committee under the POSH Act.',
  RAGGING: 'Ragging must be reported to the Anti-Ragging Committee/Squad; serious cases may need a police complaint.',
  SELF_HARM_RISK: 'If someone is at immediate risk, stay with them and call 112. Tele-MANAS: 14416.',
};

async function officers() {
  // Anyone holding safeguarding.manage — the COMPLIANCE role by default, or a
  // custom role a school granted it to.
  const roles = await Role.find({ permissions: { $elemMatch: { key: 'safeguarding.manage' } } }).select('_id').lean();
  if (!roles.length) return [];
  const tenantId = currentTenantId();
  return Profile.find({ roleId: { $in: roles.map((r) => r._id) }, status: 'ACTIVE', deletedAt: null, ...(tenantId ? { tenantId } : {}) }).select('_id').lean();
}

export async function report(actor, body = {}) {
  requireProfile(actor);
  const category = oneOf(body.category, CATEGORIES, 'category');
  const description = requireText(body.description, 'description', { max: 20000 });
  const c = new SafeguardingCase({
    refNo: await nextRef('SG'),
    category,
    urgency: oneOf(body.urgency, ['IMMEDIATE_DANGER', 'URGENT', 'STANDARD'], 'urgency', 'STANDARD'),
    reportedByProfileId: actor.profileId,
    reporterRole: actor.roleKey,
    anonymousToStaff: body.anonymousToStaff === true,
    occurredOn: parseDate(body.occurredOn, 'occurredOn'),
    descriptionEnc: encrypt(description),
  });
  pushHistory(c, { profileId: actor.profileId, displayName: c.anonymousToStaff ? 'Reporter' : actor.displayName }, 'REPORTED', { to: 'REPORTED' });
  await c.save();
  const ids = (await officers()).map((p) => String(p._id)).filter((x) => x !== String(actor.profileId));
  if (ids.length) {
    // Content-free: the category is withheld too, because even that can identify.
    await sendOperational({
      templateKey: 'GENERAL_NOTICE', recipientProfileIds: ids,
      variables: { title: `A new safeguarding report (${c.refNo}) needs your attention${c.urgency !== 'STANDARD' ? ' urgently' : ''}` },
      link: `/safeguarding?id=${c._id}`, idempotencyKey: `sg:${c._id}:reported`,
      urgency: c.urgency === 'STANDARD' ? 'NORMAL' : 'URGENT',
      relatedEntityType: 'SafeguardingCase', relatedEntityId: c._id,
    });
  }
  return { id: String(c._id), refNo: c.refNo, status: c.status, officersNotified: ids.length, guidance: STATUTORY_GUIDANCE[category] ?? null };
}

/** The reporter's own reports: reference and status only. */
export async function mine(actor) {
  requireProfile(actor);
  const rows = await SafeguardingCase.find({ reportedByProfileId: actor.profileId }).sort({ createdAt: -1 }).select('refNo category status createdAt').lean();
  return rows.map((r) => ({ id: String(r._id), refNo: r.refNo, category: r.category, status: r.status, reportedAt: r.createdAt }));
}

function present(c, { withContent = false } = {}) {
  const out = {
    id: String(c._id), refNo: c.refNo, category: c.category, urgency: c.urgency, status: c.status,
    reportedAt: c.createdAt, occurredOn: c.occurredOn, reporterRole: c.reporterRole,
    reportedByProfileId: c.anonymousToStaff ? null : String(c.reportedByProfileId),
    anonymousToStaff: c.anonymousToStaff,
    assignedOfficerProfileId: c.assignedOfficerProfileId ? String(c.assignedOfficerProfileId) : null,
    statutoryReport: c.statutoryReport,
    statutoryReportPending: c.category === 'CHILD_PROTECTION' && c.statutoryReport?.required !== false && !c.statutoryReport?.reportedAt,
    closedAt: c.closedAt,
  };
  if (withContent) {
    out.description = decrypt(c.descriptionEnc);
    out.notes = (c.notesEnc ?? []).map((n) => ({ at: n.at, byProfileId: String(n.byProfileId), text: decrypt(n.textEnc) }));
    out.history = c.history;
    out.guidance = STATUTORY_GUIDANCE[c.category] ?? null;
  }
  return out;
}

export async function list(actor, query = {}) {
  requireProfile(actor);
  const filter = {};
  if (query.status) filter.status = String(query.status).toUpperCase();
  const rows = await SafeguardingCase.find(filter).sort({ urgency: 1, createdAt: -1 }).limit(500).select('-descriptionEnc -notesEnc -history').lean();
  return rows.map((r) => present(r));
}

export async function get(actor, id) {
  requireProfile(actor);
  const c = await SafeguardingCase.findById(assertObjectId(id)).lean();
  if (!c) throw new AppError('Case not found', 404);
  // Every opening of a case's content is itself recorded.
  await recordAudit({ actor, action: 'safeguarding.read', entityType: 'SafeguardingCase', entityId: c._id, after: { fields: ['description', 'notes'] } });
  return present(c, { withContent: true });
}

export async function update(actor, id, body = {}) {
  requireProfile(actor);
  const c = await SafeguardingCase.findById(assertObjectId(id));
  if (!c) throw new AppError('Case not found', 404);
  if (String(c.reportedByProfileId) === String(actor.profileId) && body.status) {
    throw new AppError('A reporter cannot handle their own report; another designated officer must.', 403, [], 'SELF_HANDLING');
  }
  if (body.assignedOfficerProfileId !== undefined) {
    c.assignedOfficerProfileId = body.assignedOfficerProfileId ? assertObjectId(body.assignedOfficerProfileId) : null;
    pushHistory(c, actor, 'ASSIGNED');
  }
  if (body.note) {
    c.notesEnc.push({ byProfileId: actor.profileId, textEnc: encrypt(requireText(body.note, 'note', { max: 20000 })) });
    pushHistory(c, actor, 'NOTE_ADDED');
  }
  if (body.statutoryReport && typeof body.statutoryReport === 'object') {
    const s = body.statutoryReport;
    c.statutoryReport = {
      required: s.required === undefined ? c.statutoryReport?.required ?? null : Boolean(s.required),
      authority: optionalText(s.authority, { max: 200 }) || c.statutoryReport?.authority || null,
      reportedAt: parseDate(s.reportedAt, 'reportedAt') ?? c.statutoryReport?.reportedAt ?? null,
      reference: optionalText(s.reference, { max: 120 }) || c.statutoryReport?.reference || null,
      note: optionalText(s.note, { max: 2000 }) || c.statutoryReport?.note || null,
    };
    if (c.statutoryReport.required === false && !c.statutoryReport.note) throw new AppError('Record why no statutory report is required.', 400, [], 'REASON_REQUIRED');
    pushHistory(c, actor, c.statutoryReport.reportedAt ? 'STATUTORY_REPORT_RECORDED' : 'STATUTORY_ASSESSMENT');
    c.markModified('statutoryReport');
  }
  if (body.status) {
    const to = oneOf(body.status, Object.keys(MACHINE), 'status');
    assertTransition(MACHINE, c.status, to, 'case');
    if (to === 'CLOSED') {
      const reason = requireText(body.closeReason, 'closeReason', { max: 2000 });
      if (c.category === 'CHILD_PROTECTION' && c.statutoryReport?.required !== false && !c.statutoryReport?.reportedAt) {
        throw new AppError('Record the statutory report (or why none is required) before closing a child-protection case.', 409, [], 'STATUTORY_REPORT_MISSING');
      }
      c.notesEnc.push({ byProfileId: actor.profileId, textEnc: encrypt(`Closed: ${reason}`) });
      c.closedAt = new Date();
    }
    pushHistory(c, actor, to, { from: c.status, to });
    c.status = to;
  }
  await c.save();
  return present(c.toObject(), { withContent: true });
}

/** Counts only — what a principal's briefing may show, with no case detail. */
export async function counts() {
  const [open, urgent, statutoryPending] = await Promise.all([
    SafeguardingCase.countDocuments({ status: { $ne: 'CLOSED' } }),
    SafeguardingCase.countDocuments({ status: { $ne: 'CLOSED' }, urgency: { $ne: 'STANDARD' } }),
    SafeguardingCase.countDocuments({ status: { $ne: 'CLOSED' }, category: 'CHILD_PROTECTION', 'statutoryReport.reportedAt': null, 'statutoryReport.required': { $ne: false } }),
  ]);
  return { open, urgent, statutoryPending };
}
