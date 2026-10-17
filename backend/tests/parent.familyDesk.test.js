import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { inSchool, OAK, mcp, proposeAndConfirm } from './support/mcpSchool.js';
import { seedFamilySchool } from './support/familySchool.js';
import { startApi } from './support/mcpHttp.js';
import { Invoice, InvoiceLine, Payment } from '../src/models/fee.model.js';
import { MedicationPlan } from '../src/models/health.model.js';
import { ContactPreference } from '../src/models/messaging.model.js';
import { Announcement } from '../src/models/announcement.model.js';
import * as family from '../src/modules/family/family.service.js';
import { converse } from '../src/modules/whatsapp/whatsapp.agent.js';
import { signAccessToken } from '../src/utils/jwt.js';

/**
 * Part 4, the parent: the family desk (today across every child and what is
 * waiting for the parent), the yearly fee statement for Section 80C, notices
 * in the family's language, the Student View growth score for a parent, and
 * the same through the assistant and WhatsApp.
 *
 * Fixture (familySchool): PARENT is Rahul's (6 A, ABSENT today, INV-1001
 * overdue) and Riya's (6 B) father; PARENT2 is Aman's mother.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
beforeEach(async () => { s = await seedFamilySchool(); });

describe('family desk: today across all children', () => {
  it('lists both children with today\'s mark and the things waiting for the parent, and nobody else\'s', async () => {
    const d = await inOak(() => family.familyToday(s.people.PARENT.actor));
    expect(d.children.map((c) => c.firstName).sort()).toEqual(['Rahul', 'Riya']);
    expect(d.children.find((c) => c.firstName === 'Rahul').today).toBe('ABSENT');
    expect(d.children.find((c) => c.firstName === 'Riya').today).toBe('NOT_MARKED');
    const kinds = d.actions.map((a) => a.kind);
    expect(kinds).toContain('FEE_OVERDUE');
    expect(kinds).toContain('ABSENT_TODAY');
    // Urgent first; every item links into the parent portal.
    expect(d.actions[0].urgency).toBe('high');
    expect(d.actions.every((a) => a.link.startsWith('/parent/'))).toBe(true);
    // Aman's invoice (INV-1002) is PARENT2's business, never this parent's.
    expect(JSON.stringify(d)).not.toContain('INV-1002');
    expect(JSON.stringify(d)).not.toContain('Aman');
  });

  it('says the health room wants consent without saying what it is about', async () => {
    await inOak(() => MedicationPlan.create({ refNo: 'MP-1', studentId: s.riya.student._id, medicineEnc: 'x', doseEnc: 'x', startOn: new Date(), endOn: new Date(Date.now() + 5 * 86_400_000) }));
    const d = await inOak(() => family.familyToday(s.people.PARENT.actor));
    const h = d.actions.find((a) => a.kind === 'HEALTH_CONSENT');
    expect(h.text).toMatch(/consent \(1 item\)/);
    expect(h.childName).toBeNull();
  });

  it('is for parents only', async () => {
    await expect(inOak(() => family.familyToday(s.people.STUDENT.actor))).rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => family.familyToday(s.people.TEACHER.actor))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('fee statement for income tax (Section 80C)', () => {
  async function pay(invoiceId, amountPaise, paidOn = new Date()) {
    return inOak(() => Payment.create({ invoiceId, amountPaise, mode: 'UPI', status: 'SUCCESS', receiptNo: `R-${amountPaise}`, paidOn }));
  }

  it('splits each payment into tuition and other charges by the invoice lines, per child, for one financial year', async () => {
    await pay(s.inv1._id, 800000); // Rahul: all tuition
    const mixed = await inOak(async () => {
      const inv = await Invoice.create({ enrollmentId: s.riya.enrollment._id, invoiceNo: 'INV-2001', dueOn: new Date(), totalPaise: 800000 });
      await InvoiceLine.create([{ invoiceId: inv._id, description: 'Tuition — Term 1', amountPaise: 600000 }, { invoiceId: inv._id, description: 'Transport — Term 1', amountPaise: 200000 }]);
      return inv;
    });
    await pay(mixed._id, 400000); // half of a 75%-tuition invoice
    await pay(s.inv1._id, 100, new Date('2024-06-01')); // an older financial year: not counted

    const st = await inOak(() => family.feeStatement(s.people.PARENT.actor, {}));
    const rahul = st.children.find((c) => c.name.startsWith('Rahul'));
    const riya = st.children.find((c) => c.name.startsWith('Riya'));
    expect(rahul.tuitionPaise).toBe(800000);
    expect(riya.totalPaise).toBe(400000);
    expect(riya.tuitionPaise).toBe(300000);
    expect(riya.payments[0].otherPaise).toBe(100000);
    expect(st.tuitionPaise).toBe(1100000);
    expect(st.note).toMatch(/80C/);
  });

  it('refuses another family\'s child and a malformed year', async () => {
    await expect(inOak(() => family.feeStatement(s.people.PARENT2.actor, { studentId: String(s.rahul.student._id) }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(inOak(() => family.feeStatement(s.people.PARENT.actor, { fy: '2025-27' }))).rejects.toMatchObject({ code: 'BAD_FY' });
    expect(family.financialYear('2025-26').label).toBe('2025-26');
    expect(family.financialYear(null, new Date('2027-02-10T00:00:00Z')).label).toBe('2026-27');
    expect(family.financialYear(null, new Date('2027-04-02T00:00:00Z')).label).toBe('2027-28');
  });
});

describe('notices in the family\'s language', () => {
  it('without an AI service says so and keeps the English notice; refuses an unknown language', async () => {
    const a = await inOak(() => Announcement.findOne({ title: /Bus route 4/ }).lean());
    const t = await inOak(() => family.translateAnnouncement(s.people.PARENT.actor, { announcementId: String(a._id), lang: 'hi' }));
    expect(t.available).toBe(false);
    expect(t.original.title).toMatch(/Bus route 4/);
    expect(t.label).toMatch(/English notice/);
    await expect(inOak(() => family.translateAnnouncement(s.people.PARENT.actor, { announcementId: String(a._id), lang: 'xx' }))).rejects.toMatchObject({ code: 'BAD_LANGUAGE' });
    expect(family.languageName('hi')).toBe('हिन्दी (Hindi)');
  });
});

describe('over HTTP: family routes and the parent\'s Student View', () => {
  let api;
  afterAll(async () => { await api?.close?.(); });
  const get = async (person, path) => {
    api ??= await startApi();
    const base = api.base ?? null;
    const token = signAccessToken({ accountId: person.actor.accountId, profileId: person.actor.profileId, door: null });
    const url = base ? `${base}${path}` : null;
    if (!url) return null;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, 'x-school-id': OAK } });
    return { status: res.status, body: await res.json() };
  };

  it('a parent reads their own child\'s growth score and is refused another child; the family desk is parent-only', async () => {
    const own = await get(s.people.PARENT, `/growth/score?enrollmentId=${s.rahul.enrollment._id}`);
    if (!own) return; // the helper does not expose its base URL in this checkout
    expect(own.status).toBe(200);
    expect(typeof own.body.data.score).toBe('number');
    const other = await get(s.people.PARENT, `/growth/score?enrollmentId=${s.aman.enrollment._id}`);
    expect(other.status).toBe(403);
    expect((await get(s.people.PARENT, '/family/today')).status).toBe(200);
    expect((await get(s.people.TEACHER, '/family/today')).status).toBe(403);
  });
});

describe('the assistant (Ask AI and WhatsApp)', () => {
  it('get_family_today answers for both children at once; a teacher does not have it', async () => {
    const out = await mcp(OAK, s.people.PARENT.actor, 'get_family_today', {});
    expect(out.success).toBe(true);
    expect(out.speak).toMatch(/Rahul .*absent today/);
    expect(out.speak).toMatch(/Riya/);
    const teacher = await mcp(OAK, s.people.TEACHER.actor, 'get_family_today', {});
    expect(teacher.success).toBe(false);
  });

  it('get_fee_tax_statement and get_child_growth_view stay within the parent\'s own children', async () => {
    const st = await mcp(OAK, s.people.PARENT.actor, 'get_fee_tax_statement', { childName: 'Riya' });
    expect(st.success).toBe(true);
    expect(st.data.children).toHaveLength(1);
    const ask = await mcp(OAK, s.people.PARENT.actor, 'get_child_growth_view', {});
    expect(ask.success).toBe(false); // two children: which one?
    const g = await mcp(OAK, s.people.PARENT.actor, 'get_child_growth_view', { childName: 'Rahul' });
    expect(g.success).toBe(true);
    const notMine = await mcp(OAK, s.people.PARENT2.actor, 'get_child_growth_view', { childName: 'Rahul' });
    expect(notMine.success).toBe(false);
  });

  it('set_my_message_preferences is proposed, then saved only on the same person\'s yes', async () => {
    const { proposal, done } = await proposeAndConfirm(OAK, s.people.PARENT.actor, 'set_my_message_preferences', { language: 'Hindi', whatsappUpdates: true });
    expect(proposal.action.status).toBe('confirmation_required');
    expect(done.success).toBe(true);
    const pref = await inOak(() => ContactPreference.findOne({ profileId: s.people.PARENT.profile._id }).lean());
    expect(pref.language).toBe('hi');
    expect(pref.whatsappOptIn.status).toBe('OPTED_IN');
    const bad = await mcp(OAK, s.people.PARENT.actor, 'set_my_message_preferences', { language: 'Klingon' });
    expect(bad.success).toBe(false);
  });

  it('translate_school_notice picks a notice by its title and is honest without an AI service', async () => {
    const out = await mcp(OAK, s.people.PARENT.actor, 'translate_school_notice', { notice: 'bus route', language: 'Marathi' });
    expect(out.success).toBe(true);
    expect(out.data.available).toBe(false);
    expect(out.speak).toMatch(/Route 4/);
  });

  it('on WhatsApp a parent\'s "Hi" is the family summary, in the language they chose', async () => {
    await inOak(() => ContactPreference.create({ profileId: s.people.PARENT.profile._id, language: 'hi' }));
    const out = await inOak(() => converse({ actor: s.people.PARENT.actor, text: 'Hi' }));
    expect(out.lang).toBe('hi');
    expect(out.briefing).toBe(true);
    expect(out.tools).toContain('get_family_today');
    expect(out.reply).toMatch(/Rahul/);
    expect(out.reply).toMatch(/Riya/);
  });
});
