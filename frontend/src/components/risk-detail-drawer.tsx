'use client';
/**
 * Detail panel behind a risk row.
 *
 * Everything shown comes from GET /students/:id/overview, which the principal
 * already has `students.read: ALL` for — profile, current class, class
 * teacher, guardians, this month's attendance and published performance.
 *
 * The actions are deliberately limited to what the backend actually supports
 * for this role:
 *   • View student   — the overview itself, rendered here.
 *   • Contact parent — tel:/mailto: to the guardian numbers on the record.
 *   • Notify class teacher — tel:/mailto: to the section's class teacher.
 *   • Schedule meeting — POST /calendar, which the principal holds
 *     `calendar.manage` for; it creates a real PTM event on the school
 *     calendar.
 * There is no in-app messaging endpoint a principal may call (they hold
 * neither `tickets.create` nor `tickets.respond`), so "notify" is a contact
 * hand-off rather than a button that would 403.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Pill, SkeletonRows, useToast } from './ui';
import { api, ApiError } from '@/lib/api';
import { RISK_CATEGORY_LONG, RISK_LEVEL_TONE, featureLabel, featureValue } from '@/lib/risk-labels';
import type { RiskItem, StudentOverviewDto } from '@/lib/types';

export function RiskDetailDrawer({ item, onClose }: { item: RiskItem; onClose: () => void }) {
  const [overview, setOverview] = useState<StudentOverviewDto | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!item.studentId) {
      setErr('This alert has no linked student record, so the profile cannot be opened.');
      return;
    }
    setErr(null);
    api.studentOverview(item.studentId)
      .then(setOverview)
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load this student.'));
  }, [item.studentId]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previouslyFocused?.focus(); };
  }, [onClose]);

  const guardians = overview?.guardians ?? [];
  const primaryGuardian = guardians.find((g) => g.isPrimary) ?? guardians[0] ?? null;
  const classTeacher = overview?.enrollment?.classTeacher ?? null;

  return (
    // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
    // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Risk details" ref={panelRef} tabIndex={-1}>
        <div className="drawer-header">
          <div>
            <div style={{ fontFamily: 'Newsreader, serif', fontSize: 20, fontWeight: 600, color: 'var(--text-1b)' }}>
              {item.studentName}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 4, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <Pill tone={RISK_LEVEL_TONE[item.level] ?? 'gray'}>{item.level.toLowerCase()}</Pill>
              <span>{RISK_CATEGORY_LONG[item.type] ?? item.type}</span>
              <span>· {Math.round(item.probability * 100)}%</span>
              <span>· {item.class}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close risk details">×</button>
        </div>

        <div className="drawer-section" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
          <div className="drawer-section-title">Why this was flagged</div>
          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{item.summary}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {item.topFeatures.map((f, i) => (
              <span key={i} style={{ fontSize: 11.5, color: 'var(--text-2)', background: 'var(--panel-bg,#F3ECDC)', borderRadius: 6, padding: '4px 9px' }}>
                {featureLabel(f.feature)}: <b>{featureValue(f.feature, f.value)}</b>
              </span>
            ))}
          </div>
        </div>

        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 14 }}>⚠ {err}</p>}
        {!overview && !err && <div style={{ marginTop: 14 }}><SkeletonRows rows={4} /></div>}

        {overview && (
          <>
            {/* Quick actions — each one is backed by an endpoint or a device
                hand-off that genuinely works for this role. */}
            <div className="drawer-section">
              <div className="drawer-section-title">Actions</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {primaryGuardian?.phone && (
                  <a className="btn btn-soft btn-sm" href={`tel:${primaryGuardian.phone}`}>📞 Call parent</a>
                )}
                {primaryGuardian?.email && (
                  <a
                    className="btn btn-soft btn-sm"
                    href={`mailto:${primaryGuardian.email}?subject=${encodeURIComponent(`${overview.name} — ${RISK_CATEGORY_LONG[item.type] ?? 'Risk'} follow-up`)}&body=${encodeURIComponent(mailBody(overview.name, item))}`}
                  >
                    ✉ Email parent
                  </a>
                )}
                {classTeacher?.email && (
                  <a
                    className="btn btn-soft btn-sm"
                    href={`mailto:${classTeacher.email}?subject=${encodeURIComponent(`${overview.name} (${item.class}) — ${RISK_CATEGORY_LONG[item.type] ?? 'Risk'}`)}&body=${encodeURIComponent(mailBody(overview.name, item))}`}
                  >
                    ✉ Notify class teacher
                  </a>
                )}
                {classTeacher?.phone && (
                  <a className="btn btn-soft btn-sm" href={`tel:${classTeacher.phone}`}>📞 Call class teacher</a>
                )}
                <Button
                  small
                  disabled={scheduling}
                  onClick={async () => {
                    setScheduling(true);
                    try {
                      // Tomorrow, 09:00–09:30 local — a concrete slot the
                      // principal can move on the calendar afterwards.
                      const start = new Date();
                      start.setDate(start.getDate() + 1);
                      start.setHours(9, 0, 0, 0);
                      const end = new Date(start.getTime() + 30 * 60 * 1000);
                      await api.createEvent({
                        title: `Parent meeting — ${overview.name} (${item.class})`,
                        type: 'PTM',
                        startsAt: start.toISOString(),
                        endsAt: end.toISOString(),
                        description: `${RISK_CATEGORY_LONG[item.type] ?? item.type}: ${item.summary}`,
                        ...(overview.enrollment?.sectionId ? { audience: { sectionIds: [overview.enrollment.sectionId] } } : {}),
                      });
                      toast(`Meeting scheduled for ${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} at 9:00 AM — adjust it in the Calendar.`);
                    } catch (e) {
                      toast(e instanceof ApiError ? e.message : 'Could not schedule the meeting.', 'error');
                    } finally {
                      setScheduling(false);
                    }
                  }}
                >
                  {scheduling ? 'Scheduling…' : '🗓 Schedule meeting'}
                </Button>
              </div>
              {!primaryGuardian && (
                <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 8 }}>
                  No guardian contact is on file for this student, so the parent actions are unavailable.
                </p>
              )}
            </div>

            <div className="drawer-section">
              <div className="drawer-section-title">Student</div>
              <dl>
                <div className="drawer-row"><dt>Admission no</dt><dd>{overview.admissionNo || '—'}</dd></div>
                <div className="drawer-row"><dt>Class</dt><dd>{overview.enrollment?.class ?? '—'}</dd></div>
                <div className="drawer-row"><dt>Roll no</dt><dd>{overview.enrollment?.rollNo ?? '—'}</dd></div>
                <div className="drawer-row"><dt>Class teacher</dt><dd>{classTeacher?.name ?? 'Not assigned'}</dd></div>
              </dl>
            </div>

            {overview.attendance && (
              <div className="drawer-section">
                <div className="drawer-section-title">Attendance (this month)</div>
                <dl>
                  <div className="drawer-row"><dt>Present</dt><dd>{overview.attendance.PRESENT} of {overview.attendance.workingDays} days</dd></div>
                  <div className="drawer-row"><dt>Absent</dt><dd>{overview.attendance.ABSENT}</dd></div>
                  <div className="drawer-row"><dt>Late</dt><dd>{overview.attendance.LATE}</dd></div>
                  <div className="drawer-row"><dt>Attendance rate</dt><dd>{overview.attendance.pctPresent != null ? `${overview.attendance.pctPresent}%` : '—'}</dd></div>
                </dl>
              </div>
            )}

            {overview.performance && overview.performance.results.length > 0 && (
              <div className="drawer-section">
                <div className="drawer-section-title">Recent results</div>
                <dl>
                  {overview.performance.overallAvgPct != null && (
                    <div className="drawer-row"><dt>Overall average</dt><dd>{overview.performance.overallAvgPct}%</dd></div>
                  )}
                  {overview.performance.results.slice(0, 5).map((r, i) => (
                    <div className="drawer-row" key={i}>
                      <dt>{r.subject}</dt>
                      <dd>{r.marks ?? '—'} / {r.maxMarks}{r.pct != null ? ` · ${r.pct}%` : ''}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <div className="drawer-section">
              <div className="drawer-section-title">Guardians</div>
              {guardians.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>No guardians linked to this student.</p>
              )}
              {guardians.map((g, i) => (
                <div key={i} style={{ padding: '6px 0', borderTop: i ? '1px solid var(--hairline)' : 'none' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                    {g.name} <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>· {g.relation.toLowerCase()}{g.isPrimary ? ' · primary' : ''}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {g.phone || 'no phone'}{g.email ? ` · ${g.email}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function mailBody(studentName: string, item: RiskItem): string {
  return `Regarding ${studentName} (${item.class}).\n\n${item.summary}\n\n`
    + item.topFeatures.map((f) => `- ${featureLabel(f.feature)}: ${featureValue(f.feature, f.value)}`).join('\n');
}
