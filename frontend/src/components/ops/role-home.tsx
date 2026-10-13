'use client';
import Link from 'next/link';
import { Button, EmptyState } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { opsApi } from '@/lib/ops-api';
import { usePortalHref } from '@/lib/school-path';
import type { HomeDto } from '@/lib/ops-types';
import { ApprovalDecisionButtons } from './approvals-view';
import { DataNote, KpiGrid, Loadable, SectionCard, StatusPill, fmtDate, fmtDateTime, humanize, money, useLoad } from './kit';

/**
 * A role's home: what needs doing, then the few numbers that matter, each with
 * its definition. For the principal this is the daily briefing — decisions on
 * the right (approve/return/reject in place), deadlines and exceptions on the
 * left — following the dashboard reference's decision rail and live feed.
 */

function Greeting({ home }: { home: HomeDto }) {
  const { me } = useAuth();
  const hour = Number(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = me?.profile?.displayName?.split(' ')[0] ?? '';
  return (
    <div>
      <div className="ops-greeting">{part}{name ? `, ${name}` : ''}.</div>
      {home.greeting && <div className="ops-greeting-sub">{home.greeting}</div>}
    </div>
  );
}

function Tasks({ home }: { home: HomeDto }) {
  const link = usePortalHref();
  if (!home.tasks?.length) return <p className="ops-muted">No tasks assigned to you.</p>;
  return (
    <ul className="ops-list">
      {home.tasks.slice(0, 12).map((t, i) => (
        <li key={i} className="ops-row">
          <div className="ops-row-main"><Link href={link(t.link)} className="ops-row-title">{t.title}</Link><div className="ops-row-sub">{humanize(t.kind)}{t.dueOn ? ` · due ${fmtDate(t.dueOn)}` : ''}</div></div>
          {t.overdue && <span className="ops-flag-overdue">OVERDUE</span>}
        </li>
      ))}
    </ul>
  );
}

export function RoleHome({ title = 'Today' }: { title?: string }) {
  const state = useLoad(() => opsApi.home(), []);
  const link = usePortalHref();
  return (
    <Loadable state={state}>{(home) => (
      <div className="ops-stack">
        <Greeting home={home} />
        <Link className="ops-campus-card" href={link('/campus')}>
          <span className="ops-campus-card-icon" aria-hidden="true">◈</span>
          <span><b>Campus World</b><span className="ops-muted"> — walk your campus in 3D: buildings, rooms, what is scheduled, bookings and repairs.</span></span>
          <span className="btn btn-accent btn-sm">Open map</span>
        </Link>
        {home.role === 'PRINCIPAL' || home.decisions ? (
          <div className="ops-grid-main">
            <div className="ops-stack">
              <KpiGrid kpis={home.kpis} />
              {home.exceptions && home.exceptions.length > 0 && (
                <SectionCard title="Needs attention">
                  <ul className="ops-list">{home.exceptions.map((e, i) => (
                    <li key={i} className="ops-row"><StatusPill status={e.severity === 'HIGH' ? 'REJECTED' : e.severity === 'MEDIUM' ? 'PENDING' : 'DRAFT'} label={humanize(e.severity)} /><div className="ops-row-main">{e.link ? <Link href={link(e.link)}>{e.text}</Link> : e.text}</div></li>
                  ))}</ul>
                </SectionCard>
              )}
              {home.deadlines && (
                <SectionCard title="Deadlines (next 14 days)" sub="Returns, renewals, policy reviews, trainings, agreement notice dates and correspondence." actions={<Link className="btn btn-soft btn-sm" href={link('/compliance')}>Compliance centre</Link>}>
                  {!home.deadlines.length ? <p className="ops-muted">Nothing due.</p> : (
                    <ul className="ops-list">{home.deadlines.map((d) => (
                      <li key={`${d.kind}-${d.id}`} className="ops-row">
                        <div className="ops-row-main"><Link href={link(d.link)} className="ops-row-title">{d.title}</Link><div className="ops-row-sub">{humanize(d.kind)} · {fmtDate(d.renewBy ?? d.date)}</div></div>
                        {d.overdue ? <span className="ops-flag-overdue">OVERDUE</span> : <StatusPill status={d.status} />}
                      </li>
                    ))}</ul>
                  )}
                </SectionCard>
              )}
              {home.upcomingEvents && home.upcomingEvents.length > 0 && (
                <SectionCard title="Events this week">
                  <ul className="ops-list">{home.upcomingEvents.map((e) => (
                    <li key={e.id} className="ops-row"><div className="ops-row-main"><Link href={link(`/events?id=${e.id}`)} className="ops-row-title">{e.title}</Link><div className="ops-row-sub">{fmtDateTime(e.startsAt)}{e.readiness !== null ? ` · ${e.readiness}% of tasks done` : ''}</div></div><StatusPill status={e.status} /></li>
                  ))}</ul>
                </SectionCard>
              )}
              {home.meetings && (
                <SectionCard title="Meetings" actions={<Link className="btn btn-soft btn-sm" href={link('/governance')}>All meetings</Link>}>
                  {!home.meetings.length ? <p className="ops-muted">No meetings.</p> : <ul className="ops-list">{home.meetings.map((m) => <li key={m.id} className="ops-row"><div className="ops-row-main"><Link href={link(`/governance?id=${m.id}`)} className="ops-row-title">{m.title}</Link><div className="ops-row-sub">{m.scheduledAt ? fmtDateTime(m.scheduledAt) : 'Being scheduled'}</div></div><StatusPill status={m.status} /></li>)}</ul>}
                </SectionCard>
              )}
              <SectionCard title="My tasks"><Tasks home={home} /></SectionCard>
            </div>
            <aside className="ops-rail" aria-label="Decisions waiting">
              <SectionCard title="Decisions waiting on you" actions={<Link className="btn btn-soft btn-sm" href={link('/approvals')}>Open inbox</Link>}>
                {!home.decisions?.length ? <EmptyState icon="✓" title="All clear" sub="No decision is waiting on you." /> : home.decisions.map((r) => (
                  <div key={r.id} className={`ops-decision${r.isOverdue ? ' is-overdue' : ''}`}>
                    <Link href={link(`/approvals?id=${r.id}`)} className="ops-decision-title">{r.title}</Link>
                    <div className="ops-decision-meta">{humanize(r.category)} · {r.requesterName}{r.amountPaise ? ` · ${money(r.amountPaise)}` : ''} · due {fmtDate(r.dueAt)}{r.isOverdue ? ' · overdue' : ''}</div>
                    <ApprovalDecisionButtons req={r} compact onDone={() => void state.reload()} />
                  </div>
                ))}
              </SectionCard>
              <DataNote>Every number links to its records; tap ⓘ on a figure for how it is calculated. Safeguarding appears as counts only.</DataNote>
            </aside>
          </div>
        ) : (
          <>
            <KpiGrid kpis={home.kpis} />
            {home.funnel && (
              <SectionCard title="Admissions funnel">
                <div className="ops-stack">{home.funnel.map((f) => {
                  const max = Math.max(1, ...home.funnel!.map((x) => x.count));
                  return <div key={f.stage} className="ops-inline"><span style={{ width: 130 }}>{humanize(f.stage)}</span><div className="ops-bar" style={{ flex: 1 }}><span style={{ width: `${(f.count / max) * 100}%` }} /></div><b style={{ width: 40, textAlign: 'right' }}>{f.count}</b></div>;
                })}</div>
              </SectionCard>
            )}
            {home.policies && home.policies.length > 0 && (
              <SectionCard title="Policies to read and acknowledge" actions={<Link className="btn btn-soft btn-sm" href={link('/policies')}>Open</Link>}>
                <ul className="ops-list">{home.policies.map((p) => <li key={p.id} className="ops-row"><div className="ops-row-main">{p.title} (v{p.version})</div></li>)}</ul>
              </SectionCard>
            )}
            {home.trainings && home.trainings.length > 0 && (
              <SectionCard title="Upcoming trainings">
                <ul className="ops-list">{home.trainings.map((t) => <li key={t.id} className="ops-row"><div className="ops-row-main"><div className="ops-row-title">{t.title}</div><div className="ops-row-sub">{fmtDateTime(t.scheduledAt)}{t.location ? ` · ${t.location}` : ''}</div></div>{t.mandatory && <StatusPill status="PENDING" label="Mandatory" />}</li>)}</ul>
              </SectionCard>
            )}
            <SectionCard title={`${title}: my tasks`}><Tasks home={home} /></SectionCard>
          </>
        )}
        <div><Button variant="ghost" small onClick={() => void state.reload()}>↻ Refresh</Button></div>
      </div>
    )}</Loadable>
  );
}
