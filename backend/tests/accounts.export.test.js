import { describe, it, expect, beforeEach } from 'vitest';
import { seedSchool, inSchool, OAK } from './support/mcpSchool.js';
import { Invoice, InvoiceLine, Payment } from '../src/models/fee.model.js';
import * as exp from '../src/modules/fees/accounts-export.service.js';
import * as bills from '../src/modules/bills/bills.service.js';

/**
 * Accounts export: every voucher balances, Tally XML carries debits as
 * negative amounts with ISDEEMEDPOSITIVE=Yes, the CSV is the same entries,
 * and the GST summary shows only lines the school configured with a rate.
 */
let s;
const inOak = (fn) => inSchool(OAK, fn);
const today = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const range = { from: ymd(new Date(today.getTime() - 60 * 86_400_000)), to: ymd(new Date(today.getTime() + 86_400_000)) };

beforeEach(async () => { s = await seedSchool(); });

describe('voucher export', () => {
  it('produces balanced sales, receipt and payment vouchers as Tally XML and CSV', async () => {
    const finance = s.people.FINANCE.actor;
    await inOak(async () => {
      const inv = await Invoice.create({ enrollmentId: s.aman.enrollment._id, invoiceNo: 'INV/2026-27/000777', dueOn: today, totalPaise: 315000 });
      await InvoiceLine.create({ invoiceId: inv._id, description: 'Transport — Term 1', amountPaise: 300000, hsnSac: '996412', gstRateBp: 500, taxPaise: 15000 });
      await Payment.create({ invoiceId: inv._id, amountPaise: 315000, mode: 'UPI', status: 'SUCCESS', recordStatus: 'PUBLISHED', receiptNo: 'RCPT/2026-27/000001', paidOn: today });
      const acct = await bills.createAccount(finance, { name: 'Internet', category: 'INTERNET', vendorName: 'FibreNet & Co <Pvt>', billingCycle: 'MONTHLY' });
      const bill = await bills.createBill(finance, { accountId: acct.id, billDate: today, dueOn: today, amountPaise: 299900 });
      const rec = await bills.recordPayment(finance, bill.id, { amountPaise: 299900, mode: 'BANK', paidOn: today, evidence: [{ name: 'r', url: '/uploads/r.png' }] });
      await bills.confirmPayment(s.people.ADMIN.actor, bill.id, rec.payments[0]._id, { bankReference: 'UTR9' });
    });
    const built = await inOak(() => exp.buildVouchers(range));
    const types = built.vouchers.map((v) => v.type).sort();
    expect(types).toEqual(['Payment', 'Receipt', 'Sales', 'Sales', 'Sales']);
    for (const v of built.vouchers) expect(v.entries.reduce((n, e) => n + e.amountPaise, 0)).toBe(0);
    const sale = built.vouchers.find((v) => v.number === 'INV/2026-27/000777');
    expect(sale.entries.find((e) => e.ledger === 'Output CGST').amountPaise).toBe(-7500);
    const xml = exp.toTallyXml(built, { company: 'Oakridge Academy' });
    expect(xml).toMatch(/<TALLYREQUEST>Import Data<\/TALLYREQUEST>/);
    expect(xml).toMatch(/<VOUCHER VCHTYPE="Receipt" ACTION="Create">/);
    expect(xml).toMatch(/<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-3150\.00<\/AMOUNT>/);
    expect(xml).toMatch(/FibreNet &amp; Co &lt;Pvt&gt;/);
    expect(xml).not.toMatch(/FibreNet & Co </);
    const csv = exp.toCsv(built);
    expect(csv.split('\n')[0]).toBe('Date,Voucher type,Voucher no,Party,Ledger,Under group,Debit,Credit,Narration');
    expect(csv).toMatch(/Internet Charges,,2999\.00,/);
  });

  it('summarises GST by HSN/SAC and rate, and lists untaxed lines separately', async () => {
    await inOak(async () => {
      const inv = await Invoice.create({ enrollmentId: s.aman.enrollment._id, invoiceNo: 'INV/2026-27/000901', dueOn: today, totalPaise: 315000 });
      await InvoiceLine.create({ invoiceId: inv._id, description: 'Transport — Term 1', amountPaise: 300000, hsnSac: '996412', gstRateBp: 500, taxPaise: 15000 });
    });
    const gst = await inOak(() => exp.gstSummary(s.people.FINANCE.actor, range));
    expect(gst.rows).toHaveLength(1);
    expect(gst.rows[0]).toMatchObject({ hsnSac: '996412', ratePct: 5, taxablePaise: 300000, cgstPaise: 7500, sgstPaise: 7500 });
    expect(gst.untaxed.amountPaise).toBe(1300000); // the two seeded tuition invoices
    expect(gst.disclaimer).toMatch(/Not tax advice/);
  });
});
