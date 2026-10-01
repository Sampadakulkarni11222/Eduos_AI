import { AcademicYear, Term, Grade, Subject, SubjectOffering } from '../../../../models/academics.model.js';
import { Exam } from '../../../../models/exam.model.js';
import { FeeHead, FeePlan, Invoice, Payment, PaymentChangeRequest } from '../../../../models/fee.model.js';
import { Enrollment } from '../../../../models/student.model.js';
import { Lead } from '../../../../models/lead.model.js';
import { HostelInquiry } from '../../../../models/hostel.model.js';
import { TransportRoute, TransportStop } from '../../../../models/transport.model.js';
import { Profile } from '../../../../models/profile.model.js';
import { Role } from '../../../../models/role.model.js';
import { tenantFilter } from '../../../../tenancy/tenantContext.js';
import { AppError } from '../../../../utils/AppError.js';
import { classKey } from '../../../../utils/classNames.js';
import { theNamed } from './_shared.js';

/**
 * Records a person names, and the id the write needs.
 *
 * Every write in this file's callers used to take only an ObjectId for the
 * record it changes -- a term's year, a section's grade, a payment, a fee plan,
 * an exam, a route's stop. Nobody types one, so the capability existed and could
 * not be asked for: the resolver never offers a capability whose required
 * argument nothing in the sentence can supply, and "approve the pending
 * payment" reached a different write instead.
 *
 * Each resolver here reads the SAME collection the screen reads (tenant-scoped
 * by the model layer), takes an id straight through when one is given, and
 * otherwise matches by name with theNamed(): an exact name wins, a unique
 * partial match is accepted, and anything ambiguous is ASKED about, never
 * chosen -- because the wrong record here is a wrong payment, a wrong plan, a
 * wrong class.
 *
 * An id is passed through UNCHANGED, found or not. These models are
 * tenant-scoped, so another school's id reads back as nothing here -- and
 * refusing it in this layer would hide the refusal the service already makes
 * (and that the structure-parity tests pin): an id from another school is
 * refused where the write happens, with the service's own error. Only a NAME is
 * resolved here. Nothing decides what the caller may do; the tool's own
 * permission, scope and service checks still run on the resolved id.
 */

const idOf = (row) => String(row._id ?? row.id);

/** A grade as a person writes it: "Class 7", "class 7", "Grade 7", "7". */
export async function resolveGrade({ gradeId, grade } = {}) {
  if (gradeId) {
    const found = await Grade.findById(gradeId).lean().catch(() => null);
    return { id: String(gradeId), name: found?.name };
  }
  if (!grade) return null;
  const wanted = classKey(grade);
  const all = await Grade.find().lean();
  const matches = all.filter((g) => classKey(g.name) === wanted);
  if (!matches.length) throw new AppError(`I could not find a grade called "${String(grade).trim()}".`, 404, [], 'NOT_FOUND');
  return { id: idOf(matches[0]), name: matches[0].name };
}

/** The academic year named, or the current one when nothing is said. */
export async function resolveYear({ academicYearId, academicYear } = {}, { current = true } = {}) {
  if (academicYearId) {
    const found = await AcademicYear.findById(academicYearId).lean().catch(() => null);
    return { id: String(academicYearId), name: found?.name };
  }
  const years = await AcademicYear.find().sort({ startsOn: -1 }).lean();
  if (academicYear) {
    const found = theNamed(years, academicYear, { label: 'academic year', nameOf: (y) => y.name, describe: (y) => y.name });
    return { id: idOf(found), name: found.name };
  }
  if (!current) return null;
  const now = years.find((y) => y.isCurrent) ?? years[0];
  if (!now) throw new AppError('There is no academic year yet. Create one first.', 404, [], 'NOT_FOUND');
  return { id: idOf(now), name: now.name, assumed: true };
}

/** A term by name within a year ("Term 1"); with no name, the year's only term. */
export async function resolveTerm({ termId, term } = {}, year = null) {
  if (termId) {
    const found = await Term.findById(termId).lean().catch(() => null);
    return { id: String(termId), name: found?.name, academicYearId: found?.academicYearId ? String(found.academicYearId) : null };
  }
  const rows = await Term.find(year ? { academicYearId: year.id } : {}).sort({ startsOn: 1 }).lean();
  if (term) {
    const found = theNamed(rows, term, { label: 'term', nameOf: (t) => t.name, describe: (t) => t.name });
    return { id: idOf(found), name: found.name, academicYearId: String(found.academicYearId) };
  }
  if (rows.length === 1) return { id: idOf(rows[0]), name: rows[0].name, academicYearId: String(rows[0].academicYearId) };
  if (!rows.length) throw new AppError('There is no term yet. Create one first.', 404, [], 'NOT_FOUND');
  // Which is a question. The current term is the one running today, if any.
  const today = Date.now();
  const running = rows.filter((t) => new Date(t.startsOn).getTime() <= today && today <= new Date(t.endsOn).getTime());
  if (running.length === 1) return { id: idOf(running[0]), name: running[0].name, academicYearId: String(running[0].academicYearId), assumed: true };
  throw new AppError(`Which term — ${rows.slice(0, 6).map((t) => t.name).join(', ')}?`, 400, [], 'AGENT_NEEDS_INPUT');
}

export async function resolveSubject({ subjectId, subject } = {}) {
  if (subjectId) {
    const found = await Subject.findById(subjectId).lean().catch(() => null);
    return { id: String(subjectId), name: found?.name };
  }
  if (!subject) return null;
  const found = theNamed(await Subject.find().lean(), subject, { label: 'subject', nameOf: (s) => s.name, describe: (s) => s.name });
  return { id: idOf(found), name: found.name };
}

/** A staff profile of one role, named -- the teacher a class or subject is given to. */
export async function resolveStaff(roleKey, { profileId, name } = {}, label = 'teacher') {
  const role = await Role.findOne({ key: roleKey }).lean();
  if (!role) throw new AppError(`This school has no ${label} role.`, 404, [], 'NOT_FOUND');
  const rows = await Profile.find({ ...tenantFilter(), roleId: role._id, deletedAt: null }).lean();
  if (profileId) {
    const found = rows.find((p) => idOf(p) === String(profileId));
    return { id: String(profileId), name: found?.displayName };
  }
  if (!name) return null;
  const found = theNamed(rows, String(name).replace(/^(?:the|mr|mrs|ms|miss|dr)\.?\s+/i, ''), {
    label, nameOf: (p) => p.displayName, describe: (p) => p.displayName,
  });
  return { id: idOf(found), name: found.displayName };
}

/** The offering (a subject taught in a section in a term) a person means. */
export async function resolveOfferingRef({ offeringId, subject, sectionId, termId } = {}) {
  if (offeringId) {
    const found = await SubjectOffering.findById(offeringId).populate('subjectId', 'name').lean().catch(() => null);
    return { id: String(offeringId), subject: found?.subjectId?.name ?? null };
  }
  const rows = await SubjectOffering.find({ ...(sectionId && { sectionId }), ...(termId && { termId }) })
    .populate('subjectId', 'name').lean();
  const wanted = String(subject ?? '').trim().toLowerCase();
  const matches = wanted ? rows.filter((o) => String(o.subjectId?.name ?? '').toLowerCase() === wanted) : rows;
  if (!matches.length) throw new AppError(`That class does not teach ${subject ?? 'that subject'} yet.`, 404, [], 'NOT_FOUND');
  if (matches.length > 1) {
    throw new AppError(`Which one — ${matches.slice(0, 5).map((o) => o.subjectId?.name).join(', ')}? Name the subject.`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  return { id: idOf(matches[0]), subject: matches[0].subjectId?.name ?? null };
}

/** An exam by name. */
export async function resolveExam({ examId, exam } = {}) {
  if (examId) {
    const found = await Exam.findById(examId).lean().catch(() => null);
    return { id: String(examId), name: found?.name };
  }
  if (!exam) return null;
  const found = theNamed(await Exam.find().lean(), exam, { label: 'exam', nameOf: (e) => e.name, describe: (e) => e.name });
  return { id: idOf(found), name: found.name };
}

export async function resolveFeeHead({ feeHeadId, feeHead } = {}) {
  if (feeHeadId) {
    const found = await FeeHead.findById(feeHeadId).lean().catch(() => null);
    return { id: String(feeHeadId), name: found?.name };
  }
  if (!feeHead) return null;
  const found = theNamed(await FeeHead.find().lean(), feeHead, { label: 'fee head', nameOf: (h) => h.name, describe: (h) => h.name });
  return { id: idOf(found), name: found.name };
}

/**
 * The payment a person means, named by the invoice or the receipt it sits on --
 * or, for a decision, simply "the pending payment".
 *
 * `pending` restricts to payments awaiting approval, which is what approving or
 * rejecting is about. Several candidates is a question: approving the wrong
 * payment makes a stranger's money final.
 */
export async function resolvePayment({ paymentId, invoiceNo, receiptNo } = {}, { pending = false, label = 'payment' } = {}) {
  if (paymentId) {
    const found = await Payment.findById(paymentId).lean().catch(() => null);
    return { id: String(paymentId), receiptNo: found?.receiptNo ?? null, amountPaise: found?.amountPaise, recordStatus: found?.recordStatus };
  }
  let invoiceIds = null;
  if (invoiceNo) {
    const invoice = await Invoice.findOne({ invoiceNo: String(invoiceNo).trim() }).lean();
    if (!invoice) throw new AppError(`No invoice numbered ${invoiceNo}.`, 404, [], 'NOT_FOUND');
    invoiceIds = [invoice._id];
  }
  const filter = {
    ...(invoiceIds && { invoiceId: { $in: invoiceIds } }),
    ...(receiptNo && { receiptNo: String(receiptNo).trim() }),
    ...(pending && { recordStatus: 'PENDING_ADMIN_APPROVAL' }),
  };
  if (!Object.keys(filter).length) {
    throw new AppError(`Which ${label}? Name its invoice number or receipt number.`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  const rows = await Payment.find(filter).sort({ createdAt: -1 }).lean();
  if (!rows.length) {
    throw new AppError(
      pending
        ? `There is no payment awaiting approval${invoiceNo ? ` on invoice ${invoiceNo}` : ''}.`
        : `I could not find a ${label}${invoiceNo ? ` on invoice ${invoiceNo}` : ''}.`,
      404, [], 'NOT_FOUND',
    );
  }
  if (rows.length > 1) {
    throw new AppError(
      `More than one payment matches: ${rows.slice(0, 5).map((p) => `${p.receiptNo ?? 'no receipt'} ₹${(p.amountPaise / 100).toLocaleString('en-IN')} (${p.mode})`).join(', ')}. Which one?`,
      400, [], 'AGENT_NEEDS_INPUT',
    );
  }
  return { id: idOf(rows[0]), receiptNo: rows[0].receiptNo ?? null, amountPaise: rows[0].amountPaise, recordStatus: rows[0].recordStatus };
}

/** The pending payment change request a decision is about (newest when only one is open). */
export async function resolveChangeRequest({ requestId, invoiceNo, receiptNo } = {}) {
  if (requestId) {
    const found = await PaymentChangeRequest.findById(requestId).lean().catch(() => null);
    return { id: String(requestId), field: found?.field };
  }
  let paymentIds = null;
  if (invoiceNo || receiptNo) {
    const payment = await resolvePayment({ invoiceNo, receiptNo }, { label: 'payment' });
    paymentIds = [payment.id];
  }
  const rows = await PaymentChangeRequest.find({ status: 'PENDING_ADMIN_APPROVAL', ...(paymentIds && { paymentId: { $in: paymentIds } }) }).lean();
  if (!rows.length) throw new AppError('There are no pending payment change requests.', 404, [], 'NOTHING_TO_DECIDE');
  if (rows.length > 1) {
    throw new AppError(
      `${rows.length} payment change requests are pending. Name the invoice or receipt number of the payment.`,
      400, [], 'AGENT_NEEDS_INPUT',
    );
  }
  return { id: idOf(rows[0]), field: rows[0].field };
}

/**
 * The fee plan a person means: by the student it is for, optionally narrowed by
 * its status. A student with several plans is asked about, never guessed.
 */
export async function resolveFeePlanRef({ planId, plan, status } = {}, studentId = null, { label = 'fee plan' } = {}) {
  if (planId) {
    const found = await FeePlan.findById(planId).lean().catch(() => null);
    return { id: String(planId), name: found?.name, status: found?.status };
  }
  const filter = { ...(studentId && { studentId }), ...(status && { status: { $in: [].concat(status) } }) };
  let rows = await FeePlan.find(filter).lean();
  if (plan) rows = rows.filter((p) => String(p.name ?? '').toLowerCase().includes(String(plan).trim().toLowerCase()));
  if (!studentId && !plan) {
    throw new AppError(`Which ${label}? Name the student it is for.`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  if (!rows.length) throw new AppError(`I could not find a ${label}${status ? ` in that state` : ''} for them.`, 404, [], 'NOT_FOUND');
  if (rows.length > 1) {
    throw new AppError(`More than one ${label} matches: ${rows.slice(0, 5).map((p) => `"${p.name}" (${p.status})`).join(', ')}. Which one?`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  return { id: idOf(rows[0]), name: rows[0].name, status: rows[0].status };
}

/** An admission enquiry by the child's name. */
export async function resolveLead({ leadId, childName } = {}) {
  if (leadId) {
    const found = await Lead.findById(leadId).lean().catch(() => null);
    return { id: String(leadId), childName: found?.childName, stage: found?.stage };
  }
  if (!childName) throw new AppError('Which admission enquiry? Name the child.', 400, [], 'AGENT_NEEDS_INPUT');
  const found = theNamed(await Lead.find().lean(), childName, { label: 'admission enquiry', nameOf: (l) => l.childName, describe: (l) => `${l.childName} (${l.stage})` });
  return { id: idOf(found), childName: found.childName, stage: found.stage };
}

/** A hostel enquiry by its subject. */
export async function resolveInquiry({ inquiryId, subject } = {}) {
  if (inquiryId) {
    const found = await HostelInquiry.findById(inquiryId).lean().catch(() => null);
    return { id: String(inquiryId), subject: found?.subject };
  }
  if (!subject) throw new AppError('Which hostel enquiry? Give its subject.', 400, [], 'AGENT_NEEDS_INPUT');
  const found = theNamed(await HostelInquiry.find().lean(), subject, { label: 'hostel enquiry', nameOf: (i) => i.subject, describe: (i) => `"${i.subject}"` });
  return { id: idOf(found), subject: found.subject };
}

/** A bus route by name ("Route 7"), and a stop of it by name. */
export async function resolveRouteRef({ routeId, route } = {}) {
  if (routeId) {
    const found = await TransportRoute.findById(routeId).lean().catch(() => null);
    return { id: String(routeId), name: found?.name };
  }
  if (!route) return null;
  const rows = await TransportRoute.find().lean();
  // "Route 7", "7" and "route seven" all name a route called "Route 7".
  const bare = (s) => String(s ?? '').toLowerCase().replace(/^route\s*/, '').trim();
  const exact = rows.filter((r) => bare(r.name) === bare(route));
  const matched = exact.length ? exact : rows.filter((r) => r.name.toLowerCase().includes(String(route).trim().toLowerCase()));
  if (!matched.length) throw new AppError(`I could not find a route called "${String(route).trim()}".`, 404, [], 'NOT_FOUND');
  if (matched.length > 1) {
    throw new AppError(`More than one route matches "${String(route).trim()}": ${matched.slice(0, 5).map((r) => `"${r.name}"`).join(', ')}. Which one?`, 400, [], 'AGENT_NEEDS_INPUT');
  }
  return { id: idOf(matched[0]), name: matched[0].name };
}

export async function resolveStopRef({ stopId, stop } = {}, routeRef = null) {
  if (stopId) {
    const found = await TransportStop.findById(stopId).lean().catch(() => null);
    return { id: String(stopId), name: found?.name, routeId: found?.routeId ? String(found.routeId) : null };
  }
  if (!stop) return null;
  const rows = await TransportStop.find(routeRef ? { routeId: routeRef.id } : {}).lean();
  const found = theNamed(rows, stop, { label: 'stop', nameOf: (s) => s.name, describe: (s) => `"${s.name}"` });
  return { id: idOf(found), name: found.name, routeId: String(found.routeId) };
}

/** The active enrolment of an already-resolved student -- what fee writes hang off. */
export async function activeEnrollmentOf(studentId) {
  const rows = await Enrollment.find({ studentId, status: 'ACTIVE' }).populate({ path: 'sectionId', populate: 'gradeId' }).lean();
  if (!rows.length) throw new AppError('That student has no active enrolment.', 404, [], 'NOT_FOUND');
  return rows[0];
}

/**
 * People of this school, named -- the recipients of a notification.
 *
 * Every name must match exactly one profile in THIS school (Profile is not
 * tenant-scoped, so the school is filtered explicitly). "the Other teacher"
 * and "Other teacher" are the same person; two matches are asked about, not
 * both notified, and a name that matches nobody is refused rather than dropped
 * so a message is never sent to fewer people than the person believes.
 */
export async function resolveProfilesByName(names = []) {
  const rows = await Profile.find({ ...tenantFilter(), deletedAt: null, status: 'ACTIVE' }).lean();
  const out = [];
  for (const raw of names) {
    const name = String(raw ?? '').replace(/^(?:the|mr|mrs|ms|miss|dr)\.?\s+/i, '').trim();
    const found = theNamed(rows, name, { label: 'person', nameOf: (p) => p.displayName, describe: (p) => p.displayName });
    if (!out.some((p) => p.id === idOf(found))) out.push({ id: idOf(found), name: found.displayName });
  }
  return out;
}
