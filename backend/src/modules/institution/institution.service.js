import { InstitutionProfile } from '../../models/institution.model.js';
import { School } from '../../models/school.model.js';
import { currentTenantId } from '../../tenancy/tenantContext.js';
import { AppError } from '../../utils/AppError.js';
import { dto, oneOf, optionalText, parseDate, requireText } from '../ops/common.js';

/**
 * The institution profile, and the terminology every portal uses.
 *
 * A school says Class / Section / Class teacher / Term; a college says
 * Programme / Batch / Mentor / Semester. The defaults come from the
 * institution type and any word can be overridden, so a COMBINED organisation
 * (school and college on one tenant) reads naturally on each campus.
 */
export const TERMINOLOGY = {
  SCHOOL: {
    grade: 'Class', section: 'Section', classTeacher: 'Class teacher', term: 'Term',
    head: 'Principal', student: 'Student', guardian: 'Parent', faculty: 'Teacher', department: 'Department',
    course: 'Subject', governingBody: 'School Management Committee',
  },
  COLLEGE: {
    grade: 'Programme', section: 'Batch', classTeacher: 'Mentor', term: 'Semester',
    head: 'Principal / Director', student: 'Student', guardian: 'Guardian', faculty: 'Faculty', department: 'Department',
    course: 'Course', governingBody: 'Governing Body',
  },
};
TERMINOLOGY.COMBINED = { ...TERMINOLOGY.SCHOOL, governingBody: 'Governing Body' };

const TYPES = ['SCHOOL', 'COLLEGE', 'COMBINED'];
const AFFILIATION_KINDS = ['BOARD', 'UNIVERSITY', 'REGULATOR', 'ACCREDITATION', 'RECOGNITION', 'OTHER'];

async function ensure() {
  let doc = await InstitutionProfile.findOne({});
  if (!doc) {
    const slug = currentTenantId();
    const school = slug ? await School.findOne({ slug }).lean() : null;
    doc = await InstitutionProfile.create({ displayName: school?.name ?? slug ?? 'Institution', institutionType: 'SCHOOL' });
  }
  return doc;
}

/**
 * Which fields a complete profile has, and what is missing. Shown to the
 * people who maintain it; nothing is invented to fill a gap.
 */
export function completeness(p) {
  const checks = [
    ['Legal name', Boolean(p.legalName)],
    ['Legal entity (trust/society) and registration', Boolean(p.legalEntity?.type && p.legalEntity?.registrationNo)],
    ['At least one campus with district and state', (p.campuses ?? []).some((c) => c.district && c.state)],
    ['Board / university affiliation with number', (p.affiliations ?? []).some((a) => a.number)],
    ['Contact email and phone', Boolean(p.contact?.email && p.contact?.phone)],
    [p.institutionType === 'COLLEGE' ? 'AISHE code on a campus' : 'UDISE+ code on a campus',
      (p.campuses ?? []).some((c) => (p.institutionType === 'COLLEGE' ? c.aisheCode : c.udiseCode))],
    ['Academic year start month', Boolean(p.academicYearStartMonth)],
  ];
  const done = checks.filter(([, ok]) => ok).length;
  return { percent: Math.round((done / checks.length) * 100), missing: checks.filter(([, ok]) => !ok).map(([label]) => label) };
}

export function present(doc) {
  const p = dto(doc);
  p.terminology = { ...TERMINOLOGY[p.institutionType ?? 'SCHOOL'], ...(p.terminology ?? {}) };
  p.completeness = completeness(p);
  return p;
}

export async function getProfile() {
  return present(await ensure());
}

export async function updateProfile(actor, body = {}) {
  const doc = await ensure();
  if (body.displayName !== undefined) doc.displayName = requireText(body.displayName, 'displayName', { max: 160 });
  for (const f of ['legalName', 'shortName', 'motto', 'about', 'website']) {
    if (body[f] !== undefined) doc[f] = optionalText(body[f], { max: f === 'about' ? 5000 : 300 }) || null;
  }
  if (body.institutionType !== undefined) doc.institutionType = oneOf(body.institutionType, TYPES, 'institutionType');
  if (body.management !== undefined) doc.management = body.management ? oneOf(body.management, ['PRIVATE_UNAIDED', 'PRIVATE_AIDED', 'GOVERNMENT', 'CENTRAL', 'OTHER'], 'management') : null;
  if (body.establishedYear !== undefined) {
    const y = Number(body.establishedYear);
    doc.establishedYear = Number.isInteger(y) && y > 1700 && y <= new Date().getFullYear() ? y : null;
  }
  if (body.legalEntity && typeof body.legalEntity === 'object') {
    doc.legalEntity = {
      type: body.legalEntity.type ? oneOf(body.legalEntity.type, ['TRUST', 'SOCIETY', 'SECTION_8_COMPANY', 'GOVERNMENT', 'AIDED', 'OTHER'], 'legalEntity.type') : null,
      name: optionalText(body.legalEntity.name, { max: 200 }) || null,
      registrationNo: optionalText(body.legalEntity.registrationNo, { max: 100 }) || null,
      registeredOn: parseDate(body.legalEntity.registeredOn, 'registeredOn'),
    };
  }
  if (body.contact && typeof body.contact === 'object') {
    doc.contact = { email: optionalText(body.contact.email, { max: 200 }) || null, phone: optionalText(body.contact.phone, { max: 30 }) || null };
  }
  if (Array.isArray(body.boards)) doc.boards = body.boards.map((b) => String(b).trim().toUpperCase().slice(0, 30)).filter(Boolean).slice(0, 10);
  for (const f of ['academicYearStartMonth', 'financialYearStartMonth']) {
    if (body[f] !== undefined) {
      const m = Number(body[f]);
      if (!Number.isInteger(m) || m < 1 || m > 12) throw new AppError(`${f} must be 1-12`, 400);
      doc[f] = m;
    }
  }
  if (body.terminology && typeof body.terminology === 'object') {
    const allowed = Object.keys(TERMINOLOGY.SCHOOL);
    const t = {};
    for (const k of allowed) if (typeof body.terminology[k] === 'string' && body.terminology[k].trim()) t[k] = body.terminology[k].trim().slice(0, 60);
    doc.terminology = t;
  }
  if (Array.isArray(body.campuses)) {
    const codes = new Set();
    doc.campuses = body.campuses.slice(0, 50).map((c) => {
      const code = requireText(c.code, 'campus code', { max: 20 }).toUpperCase();
      if (codes.has(code)) throw new AppError(`Campus code ${code} is used twice`, 400);
      codes.add(code);
      return {
        ...(c.id ? { _id: c.id } : {}),
        code, name: requireText(c.name, 'campus name', { max: 160 }),
        type: oneOf(c.type, ['SCHOOL', 'COLLEGE'], 'campus type', 'SCHOOL'),
        addressLine: optionalText(c.addressLine, { max: 300 }) || null,
        city: optionalText(c.city, { max: 80 }) || null,
        district: optionalText(c.district, { max: 80 }) || null,
        state: optionalText(c.state, { max: 80 }) || null,
        pincode: optionalText(c.pincode, { max: 10 }) || null,
        udiseCode: optionalText(c.udiseCode, { max: 20 }) || null,
        aisheCode: optionalText(c.aisheCode, { max: 20 }) || null,
        active: c.active !== false,
      };
    });
  }
  if (Array.isArray(body.affiliations)) {
    doc.affiliations = body.affiliations.slice(0, 50).map((a) => ({
      ...(a.id ? { _id: a.id } : {}),
      body: requireText(a.body, 'affiliation body', { max: 160 }),
      kind: oneOf(a.kind, AFFILIATION_KINDS, 'affiliation kind'),
      number: optionalText(a.number, { max: 80 }) || null,
      level: optionalText(a.level, { max: 80 }) || null,
      validFrom: parseDate(a.validFrom, 'validFrom'),
      validTo: parseDate(a.validTo, 'validTo'),
      status: oneOf(a.status, ['ACTIVE', 'PROVISIONAL', 'APPLIED', 'EXPIRED', 'WITHDRAWN'], 'status', 'ACTIVE'),
      campusCode: optionalText(a.campusCode, { max: 20 }) || null,
      evidenceUrl: optionalText(a.evidenceUrl, { max: 500 }) || null,
    }));
  }
  if (Array.isArray(body.disclosures)) {
    doc.disclosures = body.disclosures.slice(0, 100).map((d) => ({
      title: requireText(d.title, 'disclosure title', { max: 200 }),
      category: optionalText(d.category, { max: 40 }) || 'GENERAL',
      url: optionalText(d.url, { max: 500 }) || null,
      text: optionalText(d.text, { max: 5000 }) || null,
      public: d.public === true,
      updatedAt: new Date(),
    }));
  }
  doc.updatedByProfileId = actor?.profileId ?? null;
  await doc.save();
  return present(doc);
}

/**
 * The parts of the profile a school has explicitly published. Served without
 * sign-in on the public page, so it returns nothing that is not marked public.
 */
export async function publicProfile() {
  const doc = await InstitutionProfile.findOne({}).lean();
  if (!doc) return null;
  return {
    displayName: doc.displayName,
    institutionType: doc.institutionType,
    motto: doc.motto,
    about: doc.about,
    website: doc.website,
    establishedYear: doc.establishedYear,
    affiliations: (doc.affiliations ?? []).filter((a) => a.status === 'ACTIVE').map((a) => ({ body: a.body, kind: a.kind, number: a.number, level: a.level })),
    campuses: (doc.campuses ?? []).filter((c) => c.active).map((c) => ({ name: c.name, city: c.city, state: c.state })),
    disclosures: (doc.disclosures ?? []).filter((d) => d.public).map((d) => ({ title: d.title, category: d.category, url: d.url, text: d.text, updatedAt: d.updatedAt })),
  };
}

export async function terminology() {
  const doc = await InstitutionProfile.findOne({}).select('institutionType terminology').lean();
  const type = doc?.institutionType ?? 'SCHOOL';
  return { institutionType: type, ...TERMINOLOGY[type], ...(doc?.terminology ?? {}) };
}
