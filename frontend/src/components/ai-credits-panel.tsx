'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Pill, SkeletonRows, StatCard, rupees } from '@/components/ui';
import { api } from '@/lib/api';
import { runCheckout, PaymentCancelled } from '@/lib/razorpay';
import type { AiCreditOrderDto, AiCreditStatusDto } from '@/lib/types';

/**
 * AI credit balance and top-up.
 *
 * Only AI-*generated* answers cost a credit, so this deliberately says so in
 * plain words. A family that thinks every attendance question is being metered
 * will use the product less than one that knows lookups are free — and telling
 * them otherwise by omission would be the same as overcharging them.
 */
export function AiCreditsPanel({ portalSlug }: { portalSlug: 'student' | 'parent' }) {
  const [status, setStatus] = useState<AiCreditStatusDto | null>(null);
  const [orders, setOrders] = useState<AiCreditOrderDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const load = useCallback(() => {
    api.aiCredits().then(setStatus).catch(() => setStatus(null));
    api.aiCreditOrders().then(setOrders).catch(() => setOrders([]));
  }, []);

  useEffect(load, [load]);

  const buy = async (packKey: string) => {
    setBusy(packKey);
    setNote(null);
    try {
      const result = await api.buyAiCredits(packKey);

      // A real gateway hands back an order to complete in checkout; the credits
      // are only granted once the signed result comes back verified.
      if (result.requiresClientAction) {
        const checkout = await runCheckout(result, {
          name: 'AI credits',
          description: `${result.order.credits} credits`,
          notes: { orderNo: result.order.orderNo },
        });
        const confirmed = await api.verifyAiCreditPurchase({
          orderId: checkout.razorpay_order_id,
          paymentId: checkout.razorpay_payment_id,
          signature: checkout.razorpay_signature,
        });
        setNote({ tone: 'ok', text: `${confirmed.order.credits} credits added.` });
      } else if (result.paid) {
        setNote({ tone: 'ok', text: `${result.order.credits} credits added.` });
      } else {
        // No gateway configured — say so rather than implying it worked.
        setNote({ tone: 'warn', text: result.message ?? 'Order created. Please pay at the school office.' });
      }
      load();
    } catch (err) {
      if (err instanceof PaymentCancelled) {
        setNote({ tone: 'warn', text: err.message });
      } else {
        setNote({ tone: 'warn', text: err instanceof Error ? err.message : 'Could not complete that purchase.' });
      }
    } finally {
      setBusy(null);
    }
  };

  if (status === null) {
    return <Card><SkeletonRows rows={3} /></Card>;
  }

  // Staff: no limit exists, so show no numbers at all.
  if (!status.metered) {
    return (
      <Card>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>AI usage</strong>
        <p style={{ fontSize: 13.5, color: 'var(--text-2b)', marginTop: 8 }}>
          {status.reason ?? 'Your AI usage is covered by the school and is not metered.'}
        </p>
      </Card>
    );
  }

  const exhausted = (status.totalRemaining ?? 0) <= 0;
  const resets = status.freeResetsOn
    ? new Date(status.freeResetsOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <StatCard
          label="Credits left"
          value={status.totalRemaining ?? 0}
          delta={exhausted ? 'add credits to continue' : 'for AI answers'}
          deltaDir={exhausted ? 'down' : 'flat'}
        />
        <StatCard
          label="Free this month"
          value={`${status.freeRemaining ?? 0} / ${status.freeAllowance ?? 0}`}
          delta={`resets ${resets}`}
          deltaDir="flat"
        />
        <StatCard label="Purchased" value={status.paidBalance ?? 0} delta="never expires" deltaDir="flat" />
      </div>

      <Card>
        <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>What uses a credit?</strong>
        <ul style={{ fontSize: 13.5, color: 'var(--text-2b)', marginTop: 10, paddingLeft: 18, lineHeight: 1.7 }}>
          <li><strong>Costs 1 credit:</strong> an AI-written explanation, practice question set, flashcards, notes or mind map from the tutor.</li>
          <li><strong>Free, always:</strong> attendance, fees, results, timetable and homework questions — those read your own records.</li>
          <li><strong>Free:</strong> anything the assistant refuses, and anything that fails on our side.</li>
        </ul>
      </Card>

      {exhausted && (
        <Card style={{ borderColor: 'var(--danger, #b42318)' }}>
          {/* A school can set the free allowance to 0 and sell credits outright,
              in which case there is no monthly reset to wait for and saying
              otherwise would be misleading. */}
          {(status.freeAllowance ?? 0) > 0 ? (
            <>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>You have used this month&apos;s free AI answers</strong>
              <p style={{ fontSize: 13.5, color: 'var(--text-2b)', marginTop: 6 }}>
                Your free allowance returns on {resets}. Everything except AI-written answers still works as normal in the meantime.
              </p>
            </>
          ) : (
            <>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16 }}>AI answers need credits</strong>
              <p style={{ fontSize: 13.5, color: 'var(--text-2b)', marginTop: 6 }}>
                This school does not include a free monthly allowance. Everything except AI-written answers still works as normal.
              </p>
            </>
          )}
        </Card>
      )}

      <Card pad={false}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Add credits</strong>
          {status.onlinePaymentEnabled === false && (
            <p style={{ fontSize: 12.5, color: 'var(--text-2b)', marginTop: 6 }}>
              Online payment is not switched on for this school — an order will be created for you to pay at the office.
            </p>
          )}
        </div>
        <div>
          {status.packs.map((pack, i) => (
            <div key={pack.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>
                  {pack.label} — {pack.credits} credits
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                  ₹{(pack.amountPaise / pack.credits / 100).toFixed(2)} per answer
                </div>
              </div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{rupees(pack.amountPaise)}</div>
              <Button small disabled={busy !== null} onClick={() => buy(pack.key)}>
                {busy === pack.key ? 'Working…' : 'Buy'}
              </Button>
            </div>
          ))}
        </div>
        {note && (
          <div
            role="status"
            style={{ padding: '12px 20px', borderTop: '1px solid var(--hairline)', fontSize: 13, color: note.tone === 'ok' ? 'var(--text-1)' : 'var(--danger, #b42318)' }}
          >
            {note.text}
          </div>
        )}
      </Card>

      <Card pad={false}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)' }}>
          <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Top-up history</strong>
        </div>
        <div style={{ padding: orders === null ? 20 : 0 }}>
          {orders === null && <SkeletonRows rows={2} />}
          {orders !== null && orders.length === 0 && (
            <EmptyState title="No purchases yet" sub="Your free monthly allowance is all you have used so far." />
          )}
          {orders?.map((o, i) => (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{o.orderNo}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                  {o.credits} credits · {o.paidAt ? new Date(o.paidAt).toLocaleDateString('en-IN') : 'not yet paid'}
                </div>
              </div>
              <div style={{ fontSize: 13 }}>{rupees(o.amountPaise)}</div>
              <Pill tone={o.status === 'PAID' ? 'green' : o.status === 'PENDING' ? 'amber' : 'red'}>
                {o.status.toLowerCase()}
              </Pill>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
