import { Pill } from '@/components/ui';
import { fileHref } from '@/lib/api';
import type { PaymentReceiptDto } from '@/lib/types';

/**
 * How a payment was actually made, and whether anyone has verified it.
 *
 * Both facts live in one file because they are always read together and were
 * previously re-implemented per page: the finance table, the admin table and
 * the family's history each drew their own version of "mode" and each showed a
 * different amount of it. A receipt that says only "BANK" cannot be
 * reconciled — the identifiers are the point of recording them.
 */

const MODE_LABEL: Record<string, string> = {
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  DD: 'Demand draft',
  BANK: 'Online / bank transfer',
  GATEWAY: 'Online (gateway)',
};

/** What each mode calls its identifiers, in its own paperwork's words. */
const NUMBER_LABEL: Record<string, string> = {
  CHEQUE: 'Cheque no.',
  DD: 'DD no.',
  BANK: 'Txn ID',
};

const dmy = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN') : null);

export function PaymentMethod({ payment, showProof = true }: { payment: PaymentReceiptDto; showProof?: boolean }) {
  const i = payment.instrument;
  const numberLabel = NUMBER_LABEL[payment.mode];
  return (
    <div className="pay-method">
      <Pill tone="blue">{MODE_LABEL[payment.mode] ?? payment.mode}</Pill>
      {i?.number && numberLabel && (
        <div className="pay-method-line">{numberLabel} {i.number}</div>
      )}
      {i?.referenceNo && <div className="pay-method-line">UTR {i.referenceNo}</div>}
      {i?.bankName && <div className="pay-method-line">{i.bankName}</div>}
      {i?.instrumentDate && <div className="pay-method-line">dated {dmy(i.instrumentDate)}</div>}
      {showProof && i?.proofUrl && (
        <a className="pay-method-proof" href={fileHref(i.proofUrl)} target="_blank" rel="noopener noreferrer">
          proof
        </a>
      )}
    </div>
  );
}

/**
 * Verification state plus its provenance.
 *
 * `verificationStatus` is served by the API; the `recordStatus` fallback keeps
 * this readable against a cached response written before that field existed.
 */
export function PaymentVerification({ payment, detailed = true }: { payment: PaymentReceiptDto; detailed?: boolean }) {
  const status = payment.verificationStatus
    ?? (payment.recordStatus === 'PENDING_ADMIN_APPROVAL'
      ? 'PENDING_VERIFICATION'
      : payment.recordStatus === 'REJECTED' ? 'REJECTED' : 'VERIFIED');

  const tone = status === 'VERIFIED' ? 'green' : status === 'REJECTED' ? 'red' : 'amber';
  const label = status === 'PENDING_VERIFICATION' ? 'Pending verification' : status === 'VERIFIED' ? 'Verified' : 'Rejected';

  return (
    <div className="pay-verify">
      <Pill tone={tone}>{label}</Pill>
      {detailed && status === 'VERIFIED' && payment.verifiedBy && (
        <div className="pay-verify-line">by {payment.verifiedBy}{payment.verifiedAt ? ` · ${dmy(payment.verifiedAt)}` : ''}</div>
      )}
      {detailed && status === 'REJECTED' && (
        <div className="pay-verify-line">
          {payment.rejectedBy ? `by ${payment.rejectedBy}` : ''}{payment.rejectedAt ? ` · ${dmy(payment.rejectedAt)}` : ''}
          {payment.rejectionReason ? ` — ${payment.rejectionReason}` : ''}
        </div>
      )}
      {detailed && payment.recordedBy && (
        <div className="pay-verify-line pay-verify-faint">
          recorded by {payment.recordedBy}{payment.recordedByRole ? ` (${payment.recordedByRole.toLowerCase()})` : ''}
        </div>
      )}
    </div>
  );
}
