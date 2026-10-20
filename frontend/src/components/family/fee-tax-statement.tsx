'use client';
import { useEffect, useState } from 'react';
import { Button, Card, SkeletonRows, rupees } from '@/components/ui';
import { familyApi, recentFinancialYears, type FeeStatementDto } from '@/lib/family-api';

/**
 * Fees paid in one financial year (April–March), per child, split into tuition
 * and other charges: what a parent needs for the Section 80C claim on their
 * income-tax return. Worked out from the school's own receipts; the page says
 * plainly that the signed certificate is the office's fee certificate.
 */
export function FeeTaxStatement() {
  const years = recentFinancialYears(4);
  const [fy, setFy] = useState(years[0]);
  const [data, setData] = useState<FeeStatementDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(null);
    setFailed(false);
    familyApi.feeStatement(fy).then(setData).catch(() => setFailed(true));
  }, [fy]);

  return (
    <Card className="fee-tax">
      <div className="fee-tax-head">
        <div>
          <strong className="fee-tax-title">Fees paid for income tax (Section 80C)</strong>
          <div className="fee-tax-sub">Tuition and other fees paid in a financial year, from the school&apos;s receipts.</div>
        </div>
        <div className="fee-tax-tools">
          <label className="fam-lang">
            <span>Financial year</span>
            <select className="input" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <Button small variant="ghost" onClick={() => window.print()} disabled={!data}>Print</Button>
        </div>
      </div>
      {failed && <p className="fam-none">Could not load the statement. Please try again.</p>}
      {!failed && !data && <SkeletonRows rows={3} />}
      {data && (
        <>
          <div className="fee-tax-totals">
            <div><span>Paid in {data.financialYear}</span><strong>{rupees(data.totalPaise)}</strong></div>
            <div><span>Of which tuition</span><strong>{rupees(data.tuitionPaise)}</strong></div>
            <div><span>Period</span><strong>{data.from} to {data.to}</strong></div>
          </div>
          {data.children.map((c) => (
            <div key={c.studentId} className="fee-tax-child">
              <div className="fee-tax-child-head">{c.name}{c.className ? ` · ${c.className}` : ''}{c.admissionNo ? ` · ${c.admissionNo}` : ''}</div>
              {c.payments.length === 0 ? <p className="fam-none">No payments in this year.</p> : (
                <table className="data-table data-table-cards">
                  <thead><tr><th>Receipt</th><th>Paid on</th><th>Amount</th><th>Tuition</th><th>Other</th></tr></thead>
                  <tbody>
                    {c.payments.map((p, i) => (
                      <tr key={`${p.receiptNo ?? 'r'}-${i}`}>
                        <td className="cell-primary" data-label="Receipt">{p.receiptNo ?? '—'}{p.invoiceNo ? <div className="fee-tax-inv">{p.invoiceNo}</div> : null}</td>
                        <td data-label="Paid on">{p.paidOn}</td>
                        <td data-label="Amount">{rupees(p.amountPaise)}</td>
                        <td data-label="Tuition">{p.split === 'NO_LINES' ? 'Not itemised' : rupees(p.tuitionPaise)}</td>
                        <td data-label="Other">{rupees(p.otherPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          <p className="fee-tax-note">{data.note}</p>
        </>
      )}
    </Card>
  );
}
