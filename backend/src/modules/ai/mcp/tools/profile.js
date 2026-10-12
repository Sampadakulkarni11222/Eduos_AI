import * as authService from '../../../auth/auth.service.js';
import * as academics from '../../../academics/academics.service.js';
import * as students from '../../../students/student.service.js';
import { Profile } from '../../../../models/profile.model.js';
import { ok } from '../protocol.js';
import { RISK } from './_shared.js';
import { PROFILE_FIELDS } from '../../agent/profileIntent.js';

/**
 * The caller's own profile.
 *
 * One tool, fronting the service the portal's own "me" endpoint uses
 * (auth.service.me), because that service already resolves the profile from the
 * authenticated actor and nothing else. There is deliberately no argument
 * naming a person: identity comes from the MCP session, so "whose profile" is
 * not something a model can influence, and a question about somebody else
 * cannot be answered here at all — it routes to the student or user tools,
 * where the existing ownership and scope rules apply.
 *
 * Gated on `ai.copilot.use`, which every role that can use the assistant
 * holds by definition — it is the permission that admits them to it: reading
 * your own name needs no grant beyond being signed in,
 * and inventing a new permission for it would have been a broadening rather
 * than a check.
 *
 * HONESTY ABOUT WHAT THE ERP HOLDS. A Profile carries a display name, a role, a
 * school, a status and an avatar; the Account carries a phone and an email.
 * There is no employee ID, designation, department or reporting manager
 * anywhere in the schema, and no HR joining date. Those categories are
 * therefore answered "not recorded" — named as unavailable rather than silently
 * dropped, and never filled in with a plausible value. When the school starts
 * storing them, this tool grows a field; until then it says so.
 *
 * Classes and subjects stay their own capabilities (get_my_classes,
 * get_subjects). The whole-profile answer mentions how many of each there are,
 * from the same services those tools call, so "tell me everything about me" is
 * useful — but a question about classes or subjects routes to the tool that
 * actually lists them.
 */

/** Role keys as a person would say them. Falls back to the key, title-cased. */
const ROLE_NAMES = {
  TEACHER: 'Teacher',
  ADMIN: 'Administrator',
  PRINCIPAL: 'Principal',
  FINANCE: 'Finance staff',
  LIBRARIAN: 'Librarian',
  WARDEN: 'Warden',
  PARENT: 'Parent',
  STUDENT: 'Student',
  SUPER_ADMIN: 'Platform administrator',
};

function roleName(key) {
  if (ROLE_NAMES[key]) return ROLE_NAMES[key];
  // A school's own custom role ("HEAD_OF_SCIENCE") reads as a phrase rather
  // than a constant. Written out rather than chained, because `??` and `||`
  // may not be mixed in one expression.
  const spelled = String(key ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
  return spelled || 'User';
}

/**
 * Categories the schema knows about but the ERP does not store, and how to say
 * so. Each phrasing names what is missing without naming a database field.
 */
const NOT_RECORDED = {
  employeeId: 'The school does not record an employee or staff ID in EduOS.',
  designation: 'EduOS does not hold a separate job title — the nearest thing on your profile is your role.',
  department: 'The school does not record a department in EduOS.',
  reportingManager: 'The school does not record a reporting manager in EduOS.',
};

/**
 * Roles whose profile is a FAMILY profile, not a staff one.
 *
 * The whole-profile answer was written for staff and read out to everyone: a
 * student was told they were "assigned to 1 class(es) and teach 1 subject(s)"
 * and that the school "does not record an employee ID, designation, department
 * or reporting manager" -- staff vocabulary on a child's profile. A student has
 * a class, a roll number and an admission number; a parent has children. Those
 * are what their profile says, and the staff categories are not mentioned at
 * all unless asked for, when they are said not to apply.
 */
const FAMILY_ROLES = new Set(['STUDENT', 'PARENT']);
const STAFF_ONLY = 'That is a staff detail — it does not apply to a student or parent profile.';

/**
 * The student record(s) behind a family profile: the caller's own for a
 * student, their linked children for a parent. Read through the student
 * directory at the caller's OWN scope -- the same read the portal's own screens
 * make -- so it can only ever return records the caller already sees, and
 * nothing when they hold no students.read.
 */
async function ownStudentRecords(ctx) {
  if (ctx.actor?.permissions?.['students.read'] !== 'OWN') return [];
  try {
    const page = await students.list(ctx.actor, 'OWN', { page: 1, pageSize: 20 });
    return (page.items ?? []).map((st) => ({
      name: st.name,
      admissionNo: st.admissionNo ?? null,
      class: st.enrollment?.class ?? null,
      rollNo: st.enrollment?.rollNo ?? null,
    }));
  } catch {
    // An account with no linked student simply has none to describe.
    return [];
  }
}

const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null);

export const profileTools = {
  get_my_profile: {
    module: 'Profile',
    operation: 'GET',
    risk: RISK.LOW,
    description:
      "The caller's own profile, from their signed-in identity: name, role, school, contact details, account status and when the profile was created. Use it for any question a person asks about themselves — \"what is my name\", \"show my profile\", \"tell me about myself\", \"what is my designation\", \"what is my employee id\", \"when did I join\". Pass `field` to answer one category, or omit it for everything. It answers only about the caller — there is no way to name another person — and it says plainly when the school does not record something rather than guessing. For the classes someone teaches use get_my_classes, for their subjects get_subjects, for their timetable get_timetable. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          enum: PROFILE_FIELDS,
          description: 'Which category to answer: all (default), name, role, school, contact, status, joined, employeeId, designation, department, reportingManager',
        },
      },
      additionalProperties: false,
    },
    permission: 'ai.copilot.use',
    service: 'auth.service.me() + academics.service.getMySections()/getMyOfferings()',
    async run(ctx, args) {
      const field = args.field ?? 'all';

      // The same read the portal's own /auth/me performs, resolved from the
      // session actor. No argument reaches it, so nothing a model wrote can
      // change whose profile this is.
      const me = await authService.me(ctx.actor);
      const profileRow = await Profile.findById(ctx.actor.profileId).select('createdAt').lean();

      const name = me.profile?.displayName ?? ctx.actor.displayName ?? null;
      const role = roleName(me.profile?.role ?? ctx.actor.roleKey);
      const school = me.profile?.tenantName ?? ctx.actor.tenantName ?? null;
      const createdOn = shortDate(profileRow?.createdAt);

      // A single unavailable category is an answer in itself: the person asked
      // something reasonable and deserves to know it is not held, not a
      // fabricated value and not silence.
      const family = FAMILY_ROLES.has(ctx.actor?.roleKey);
      if (NOT_RECORDED[field] && family) {
        return ok({ field, available: false, applicable: false }, { speak: STAFF_ONLY });
      }
      if (NOT_RECORDED[field]) {
        return ok(
          { field, available: false, unavailable: [field], ...(field === 'designation' && { role }) },
          {
            speak: field === 'designation'
              ? `${NOT_RECORDED.designation} You are registered as a ${role}.`
              : NOT_RECORDED[field],
          },
        );
      }

      const answers = {
        name: () => ({ data: { name }, speak: name ? `You are ${name}.` : 'Your profile has no name recorded.' }),
        role: () => ({ data: { role }, speak: `You are registered as a ${role}${school ? ` at ${school}` : ''}.` }),
        school: () => ({ data: { school }, speak: school ? `You are at ${school}.` : 'No school is recorded on your profile.' }),
        status: () => ({ data: { status: me.profile?.status ?? 'ACTIVE' }, speak: 'Your account is active.' }),
        // Asked for one, answered with one: a question about the email does not
        // read out the phone number as well.
        email: () => ({
          data: { email: me.email ?? null },
          speak: me.email ? `Your email address on file is ${me.email}.` : 'No email address is recorded on your account.',
        }),
        phone: () => ({
          data: { phone: me.phone ?? null },
          speak: me.phone ? `Your phone number on file is ${me.phone}.` : 'No phone number is recorded on your account.',
        }),
        contact: () => {
          const bits = [me.phone && `phone ${me.phone}`, me.email && `email ${me.email}`].filter(Boolean);
          return {
            data: { phone: me.phone ?? null, email: me.email ?? null },
            speak: bits.length
              ? `Your contact details on file: ${bits.join(', ')}.`
              : 'No phone number or email is recorded on your account.',
          };
        },
        joined: () => ({
          data: { profileCreatedOn: createdOn },
          // Deliberately not called a joining date: it is when the EduOS
          // profile was created, which is the only date the ERP actually has.
          speak: createdOn
            ? `Your EduOS profile was created on ${createdOn}. The school does not record a separate joining date here.`
            : 'The school does not record a joining date in EduOS.',
        }),
      };

      if (answers[field]) {
        const { data, speak } = answers[field]();
        return ok({ field, ...data }, { speak });
      }

      /* field === 'all', for a student or a parent: their own schema. */
      if (family) {
        const records = await ownStudentRecords(ctx);
        const contact = [me.phone, me.email].filter(Boolean).join(', ');
        const describe = (r) => [
          r.name,
          r.class && `${r.class}`,
          r.rollNo != null && `roll no ${r.rollNo}`,
          r.admissionNo && `admission no ${r.admissionNo}`,
        ].filter(Boolean).join(', ');
        let about = '';
        if (ctx.actor.roleKey === 'STUDENT') {
          const own = records[0];
          about = own
            ? ` You are in ${[own.class, own.rollNo != null && `roll no ${own.rollNo}`].filter(Boolean).join(', ') || 'no class yet'}`
              + `${own.admissionNo ? `, admission no ${own.admissionNo}` : ''}.`
            : ' No student record is linked to this account yet.';
        } else {
          about = records.length
            ? ` Your ${records.length === 1 ? 'child' : 'children'}: ${records.map(describe).join('; ')}.`
            : ' No child is linked to this account yet — please contact the school office.';
        }
        return ok(
          {
            field: 'all',
            name,
            role,
            school,
            status: me.profile?.status ?? 'ACTIVE',
            phone: me.phone ?? null,
            email: me.email ?? null,
            profileCreatedOn: createdOn,
            ...(ctx.actor.roleKey === 'STUDENT' ? { student: records[0] ?? null } : { children: records }),
          },
          {
            speak:
              `${[name && `You are ${name}`, `registered as a ${role}`, school && `at ${school}`].filter(Boolean).join(', ')}.`
              + about
              + (contact ? ` Contact: ${contact}.` : '')
              + (createdOn ? ` Your profile was created on ${createdOn}.` : ''),
          },
        );
      }

      /* field === 'all' — the whole profile. */
      // Class and subject counts come from the same services get_my_classes and
      // get_subjects use, and only when the caller may read them.
      let classesTaught = null;
      let subjectsTaught = null;
      if (ctx.actor?.permissions?.['timetable.read']) {
        const [sections, offerings] = await Promise.all([
          academics.getMySections(ctx.actor).catch(() => []),
          academics.getMyOfferings(ctx.actor).catch(() => []),
        ]);
        classesTaught = (sections ?? []).length;
        subjectsTaught = new Set((offerings ?? []).map((o) => o.subjectId?.name).filter(Boolean)).size;
      }

      const unavailable = Object.keys(NOT_RECORDED);
      const lines = [
        name && `You are ${name}`,
        `registered as a ${role}`,
        school && `at ${school}`,
      ].filter(Boolean).join(', ');
      const contact = [me.phone, me.email].filter(Boolean).join(', ');

      return ok(
        {
          field: 'all',
          name,
          role,
          school,
          status: me.profile?.status ?? 'ACTIVE',
          phone: me.phone ?? null,
          email: me.email ?? null,
          profileCreatedOn: createdOn,
          ...(classesTaught !== null && { classesTaught, subjectsTaught }),
          // Named, so the answer is honest about its own gaps.
          unavailable,
        },
        {
          speak:
            `${lines}.` +
            (contact ? ` Contact: ${contact}.` : '') +
            (classesTaught !== null ? ` You are assigned to ${classesTaught} class(es) and teach ${subjectsTaught} subject(s).` : '') +
            (createdOn ? ` Your profile was created on ${createdOn}.` : '') +
            ' The school does not record an employee ID, designation, department or reporting manager in EduOS.',
        },
      );
    },
  },
};
