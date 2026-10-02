'use client';
import { Pill } from '../ui';
import type { DocumentRequestDto, DocumentRequestStatus, DocumentTypeField } from '@/lib/document-request-types';

/** Shared by the student panel and the office pages, so both read a status the same way. */
export const STATUS_LABEL: Record<DocumentRequestStatus, { text: string; tone: 'green' | 'amber' | 'red' | 'gray' | 'blue' | 'maroon' }> = {
  PENDING: { text: 'Pending', tone: 'amber' },
  UNDER_REVIEW: { text: 'Under review', tone: 'blue' },
  APPROVED: { text: 'Approved', tone: 'blue' },
  REJECTED: { text: 'Rejected', tone: 'red' },
  READY: { text: 'Ready', tone: 'green' },
  COMPLETED: { text: 'Completed', tone: 'gray' },
  CANCELLED: { text: 'Cancelled', tone: 'gray' },
};

export const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, { text }]) => ({ value, label: text }));

export function StatusPill({ status }: { status: DocumentRequestStatus }) {
  const s = STATUS_LABEL[status] ?? { text: status, tone: 'gray' as const };
  return <Pill tone={s.tone}>{s.text}</Pill>;
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A label/value grid of everything the student submitted and the office decided. */
export function RequestFacts({ r }: { r: DocumentRequestDto }) {
  const rows: Array<[string, string | null]> = [
    ['Document', r.documentTypeName],
    ['Requested on', fmtDate(r.requestedAt)],
    ['Purpose', r.purpose],
    ...r.requestData.map((a): [string, string | null] => [a.label, a.value]),
    ['Additional information', r.additionalInformation],
    ['Required by', r.requiredBy ? fmtDate(r.requiredBy) : null],
    ['Approved on', r.approvedAt ? fmtDate(r.approvedAt) : null],
    ['Office remarks', r.adminRemarks],
    ['Rejection reason', r.rejectionReason],
    ['Issued on', r.issuedAt ? fmtDate(r.issuedAt) : null],
  ];
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', gap: '6px 14px', fontSize: 13.5, margin: 0 }}>
      <dt style={{ color: 'var(--text-2)' }}>Status</dt>
      <dd style={{ margin: 0 }}><StatusPill status={r.status} /></dd>
      {rows.filter(([, v]) => v).map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--text-2)' }}>{label}</dt>
          <dd style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One configured question on a document type, rendered as the right control. */
export function FieldInput({ field, value, onChange, id }: {
  field: DocumentTypeField; value: string; onChange: (v: string) => void; id: string;
}) {
  const common = { id, className: 'field-input', value, required: field.required, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  if (field.kind === 'textarea') return <textarea rows={3} maxLength={2000} {...common} />;
  if (field.kind === 'select') {
    return (
      <select {...common}>
        <option value="">Select…</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return <input type={field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'} maxLength={500} {...common} />;
}
