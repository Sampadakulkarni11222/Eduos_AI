'use client';
import type { CampusMomentDto, TeacherPublicDto } from '@/lib/ops-types';

/**
 * What the school day is doing at the moment shown on the map: open or closed
 * (holiday, weekly off, vacation, closure, exam-only day), each shift's bell
 * ("Period 3 of 8, 12 min left", "Lunch", "Dispersal"), and when the school
 * next opens. Computed by the server from the calendar, the shifts' bell
 * schedules and the timetable for that date and time, never from "now" alone.
 */
const TONE_ICON: Record<string, string> = { class: '✎', break: '☕', closed: '☾', holiday: '✦', exam: '✍', arrival: '⇢', clubs: '⚑' };
const PHASE_WORD: Record<string, string> = { BEFORE: 'not yet open', AFTER: 'day over', ARRIVAL: 'arriving', ASSEMBLY: 'assembly', PERIOD: 'in lessons', BREAK: 'break', LUNCH: 'lunch', PASSING: 'changeover', DISPERSAL: 'going home', CLUBS: 'clubs' };

export function MomentBanner({ moment, compact = false }: { moment: CampusMomentDto | null | undefined; compact?: boolean }) {
  if (!moment) return null;
  const b = moment.banner;
  const showShifts = moment.shifts.length > 1;
  return (
    <div className={`cwm-banner is-${b.tone}${compact ? ' is-compact' : ''}`} role="status" aria-live="polite" data-testid="moment-banner">
      <span className="cwm-icon" aria-hidden="true">{TONE_ICON[b.tone] ?? '◷'}</span>
      <div className="cwm-text">
        <b>{b.text}</b>
        {b.sub && <span className="cwm-sub">{b.sub}</span>}
        {showShifts && !compact && (
          <span className="cwm-shifts">
            {moment.shifts.map((s) => (
              <span key={s.code} className="cwm-shift" title={s.label}>
                <i style={{ background: s.color ?? 'var(--accent, #4F86E8)' }} aria-hidden="true" />{s.name}: {PHASE_WORD[s.phase] ?? s.phase.toLowerCase()}
              </span>
            ))}
          </span>
        )}
      </div>
      {!moment.live && <span className="cwm-when">{moment.isToday ? `Today ${moment.time}` : `${moment.date} ${moment.time}`}</span>}
      {moment.buses.phase !== 'AWAY' && !compact && <span className="cwm-bus" title={moment.buses.label}>⛟ {moment.buses.phase === 'ARRIVING' ? 'arriving' : moment.buses.phase === 'DEPARTING' ? 'leaving' : 'parked'}</span>}
    </div>
  );
}

/** Only what a teacher chose to share with families (the server sends nothing else). */
export function TeacherAbout({ about, compact = false }: { about: TeacherPublicDto | null | undefined; compact?: boolean }) {
  if (!about || !about.shown?.length) return null;
  const q = about.qualifications?.map((x) => [x.degree, x.institution, x.year].filter(Boolean).join(', ')).join('; ');
  const subj = [...(about.subjects ?? []), ...(about.specialisations ?? [])].join(', ');
  const certs = about.certifications?.map((c) => [c.name, c.year].filter(Boolean).join(' ')).join(', ');
  return (
    <dl className={`cwm-about${compact ? ' is-compact' : ''}`} aria-label="About the teacher">
      {q && <><dt>Qualifications</dt><dd>{q}</dd></>}
      {subj && <><dt>Subjects</dt><dd>{subj}</dd></>}
      {about.experienceYears !== undefined && <><dt>Experience</dt><dd>{about.experienceYears} years</dd></>}
      {certs && <><dt>Certifications</dt><dd>{certs}</dd></>}
      {about.bio && !compact && <><dt>About</dt><dd>{about.bio}</dd></>}
    </dl>
  );
}
