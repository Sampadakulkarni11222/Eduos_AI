'use client';
import { useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Card, SkeletonRows, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import type { InvoiceDto, FeeSummary, PaymentReceiptDto } from '@/lib/types';
import { FeeDashboardCards } from '@/components/fees/fee-dashboard-cards';
import { FeeBreakdownChart } from '@/components/fees/fee-breakdown-chart';
import { PaymentHistoryChart } from '@/components/fees/payment-history-chart';
import { InvoiceList } from '@/components/fees/invoice-list';
import { PayInvoiceModal } from '@/components/fees/pay-invoice-modal';
import { InvoiceTimelineModal } from '@/components/fees/invoice-timeline-modal';
import { PaymentHistoryTable } from '@/components/fees/payment-history-table';

type Tab = 'overview' | 'pending' | 'paid' | 'history';

export default function StudentPayments() {
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[] | null>(null);
  const [payments, setPayments] = useState<PaymentReceiptDto[] | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [paying, setPaying] = useState<InvoiceDto | null>(null);
  const [timelineInvoiceId, setTimelineInvoiceId] = useState<string | null>(null);
  const toast = useToast();

  const loadAll = () => {
    api.feeSummary().then(setSummary).catch(() => setSummary(null));
    api.invoices().then(setInvoices).catch(() => setInvoices([]));
    api.listPayments().then(setPayments).catch(() => setPayments([]));
  };
  useEffect(loadAll, []);

  const loading = invoices === null || summary === null || payments === null;
  const pendingInvoices = (invoices ?? []).filter((i) => i.status !== 'PAID' && i.status !== 'CANCELLED');
  const paidInvoices = (invoices ?? []).filter((i) => i.status === 'PAID');

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Payments', desc: 'Your fee invoices, payment history, and receipts.' }}>
      <FeeDashboardCards summary={summary} />

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>Pending Invoices</button>
        <button className={`tab ${tab === 'paid' ? 'active' : ''}`} onClick={() => setTab('paid')}>Paid Invoices</button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>Payment History</button>
      </div>

      {loading && <Card><SkeletonRows rows={5} /></Card>}

      {!loading && tab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <Card>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Fee Breakdown</strong>
              <div style={{ marginTop: 14 }}>
                <FeeBreakdownChart paidPaise={summary!.totalCollectedPaise} pendingPaise={summary!.pendingPaise} overduePaise={summary!.overduePaise} />
              </div>
            </Card>
            <Card>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Payment Trend</strong>
              <div style={{ marginTop: 10 }}>
                <PaymentHistoryChart payments={payments!} />
              </div>
            </Card>
          </div>

          <Card pad={false}>
            <div style={{ padding: '16px 20px 0' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>Fee History</strong>
            </div>
            <InvoiceList invoices={invoices!} onPay={setPaying} onViewTimeline={(inv) => setTimelineInvoiceId(inv.id)} />
          </Card>
        </>
      )}

      {!loading && tab === 'pending' && (
        <Card pad={false}>
          <InvoiceList invoices={pendingInvoices} onPay={setPaying} onViewTimeline={(inv) => setTimelineInvoiceId(inv.id)} />
        </Card>
      )}

      {!loading && tab === 'paid' && (
        <Card pad={false}>
          <InvoiceList invoices={paidInvoices} onPay={setPaying} onViewTimeline={(inv) => setTimelineInvoiceId(inv.id)} />
        </Card>
      )}

      {!loading && tab === 'history' && (
        <Card pad={false}>
          <PaymentHistoryTable payments={payments!} />
        </Card>
      )}

      {paying && (
        <PayInvoiceModal
          invoice={paying}
          onClose={() => setPaying(null)}
          onPaid={(receiptNo, sandbox) => {
            setPaying(null);
            // The flag means "no real money moved" — true for both the sandbox provider
            // and SpeedyPay. Saying "sandbox" for a SpeedyPay payment named the wrong one.
            toast(`Payment successful — receipt ${receiptNo}${sandbox ? ' (test payment — no money moved)' : ''}.`);
            loadAll();
          }}
        />
      )}

      {timelineInvoiceId && (
        <InvoiceTimelineModal invoiceId={timelineInvoiceId} onClose={() => setTimelineInvoiceId(null)} />
      )}
    </PortalShell>
  );
}
