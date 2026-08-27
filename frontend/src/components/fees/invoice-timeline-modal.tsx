'use client';
import { useEffect, useState } from 'react';
import { Button, SkeletonRows, rupees } from '../ui';
import { api } from '@/lib/api';
import type { InvoiceDetailDto } from '@/lib/types';

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface TimelineEvent {
  at: string;
  title: string;
  detail?: string;
  color: string;
  action?: { label: string; onClick: () => void };
}

export function InvoiceTimelineModal({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<InvoiceDetailDto | null>(null);

  useEffect(() => {
    api.invoiceDetail(invoiceId).then(setDetail).catch(() => setDetail(null));
  }, [invoiceId]);

  const events: TimelineEvent[] = [];
  if (detail) {
    events.push({
      at: detail.createdAt,
      title: 'Invoice raised',
      detail: `${rupees(detail.totalPaise)} billed`,
      color: 'var(--blue)',
    });
    for (const p of detail.payments) {
      const isSuccess = p.status === 'SUCCESS' || p.status === 'CAPTURED';
      const isRefunded = p.status === 'REFUNDED';
      events.push({
        at: p.createdAt,
        title: isSuccess ? 'Payment received' : isRefunded ? 'Payment refunded' : `Payment ${p.status.toLowerCase()}`,
        detail: `${rupees(p.amountPaise)} · ${p.mode} · ${p.receiptNo}`,
        color: isSuccess ? 'var(--green)' : isRefunded ? 'var(--amber)' : 'var(--red)',
        action: isSuccess ? { label: 'Download Receipt PDF', onClick: () => api.downloadReceiptPdf(p.id) } : undefined,
      });
    }
    const overdue = new Date(detail.dueOn) < new Date() && detail.status !== 'PAID' && detail.status !== 'CANCELLED';
    events.push({
      at: detail.dueOn,
      title: 'Due date',
      detail: overdue ? 'Overdue' : undefined,
      color: overdue ? 'var(--red)' : 'var(--amber)',
    });
  }
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div className="modal-title">{detail ? `Invoice ${detail.invoiceNo}` : 'Invoice timeline'}</div>
          <button className="modal-close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
        </div>

        {!detail && <SkeletonRows rows={4} />}

        {detail && (
          <>
            <div style={{ marginBottom: 16 }}>
              <Button small variant="soft" onClick={() => api.downloadInvoicePdf(detail.id)}>Download Invoice PDF</Button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {events.map((ev, i) => (
                <div key={i} style={{ display: 'flex', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: ev.color, flexShrink: 0, marginTop: 3 }} />
                    {i < events.length - 1 && <span style={{ width: 2, flex: 1, background: 'var(--hairline)', marginTop: 2 }} />}
                  </div>
                  <div style={{ paddingBottom: 20, flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{fmtDateTime(ev.at)}</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)', marginTop: 2 }}>{ev.title}</div>
                    {ev.detail && <div style={{ fontSize: 12, color: 'var(--text-2b)', marginTop: 2 }}>{ev.detail}</div>}
                    {ev.action && (
                      <button
                        onClick={ev.action.onClick}
                        style={{ fontSize: 11.5, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, marginTop: 4, padding: 0 }}
                      >
                        {ev.action.label} →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: 8 }}>
          <Button variant="ghost" type="button" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
