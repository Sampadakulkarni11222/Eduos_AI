'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Pill, SkeletonRows, rupees, useToast } from '@/components/ui';
import { useSchoolHref } from '@/lib/school-path';
import { familyApi, type FamilyLanguage, type FamilyTodayDto } from '@/lib/family-api';

/**
 * "Today for your family": the first thing a parent sees. Every child at once
 * (today's register mark, homework due, fees, the next exam) and everything
 * waiting for the parent, each with a link to where they act. Built for the
 * working parent with a minute on a phone, and for the parent with children in
 * two classes who should not have to switch child to find out if all is well.
 */

const TODAY: Record<string, { label: string; tone: 'green' | 'red' | 'amber' | 'gray' | 'blue' }> = {
  PRESENT: { label: 'Present today', tone: 'green' },
  ABSENT: { label: 'Absent today', tone: 'red' },
  LATE: { label: 'Late today', tone: 'amber' },
  EXCUSED: { label: 'Excused today', tone: 'blue' },
  HALF_DAY: { label: 'Half day today', tone: 'amber' },
  NOT_MARKED: { label: 'Not marked yet', tone: 'gray' },
  NOT_ENROLLED: { label: 'Not enrolled', tone: 'gray' },
};

function dayLabel(ymd: string) {
  const d = new Date(`${ymd}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

export function FamilyToday() {
  const link = useSchoolHref();
  const toast = useToast();
  const [data, setData] = useState<FamilyTodayDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [languages, setLanguages] = useState<FamilyLanguage[]>([]);
  const [lang, setLang] = useState('en');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    familyApi.today().then((d) => { setData(d); setLang(d.language || 'en'); }).catch(() => setFailed(true));
    familyApi.languages().then(setLanguages).catch(() => setLanguages([]));
  }, []);

  const saveLanguage = async (next: string) => {
    const before = lang;
    setLang(next);
    setSaving(true);
    try {
      await familyApi.savePreferences({ language: next });
      toast('Saved. School messages and the assistant will use this language where they can.', 'success');
    } catch {
      setLang(before);
      toast('Could not save the language. Please try again.', 'error');
    } finally { setSaving(false); }
  };

  if (failed) return null; // The rest of the dashboard still shows each child; this card is a summary on top.
  if (!data) return <div className="card card-pad fam-today"><SkeletonRows rows={3} /></div>;
  if (!data.children.length) return null;

  return (
    <section className="card card-pad fam-today" aria-labelledby="fam-today-title">
      <div className="fam-head">
        <div>
          <h2 id="fam-today-title" className="fam-title">Today for your family</h2>
          <div className="fam-sub">{dayLabel(data.date)} · {data.children.length === 1 ? data.children[0].firstName : `${data.children.length} children`}</div>
        </div>
        {languages.length > 0 && (
          <label className="fam-lang">
            <span>Messages in</span>
            <select className="input" value={lang} disabled={saving} onChange={(e) => void saveLanguage(e.target.value)} aria-label="Language for school messages">
              {languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="fam-block">
        <div className="fam-label">{data.actions.length ? `Waiting for you (${data.actions.length})` : 'Waiting for you'}</div>
        {data.actions.length === 0 ? (
          <p className="fam-none">Nothing needs you today.</p>
        ) : (
          <ul className="fam-actions">
            {data.actions.slice(0, 6).map((a, i) => (
              <li key={`${a.kind}-${i}`} className={`fam-action ${a.urgency === 'high' ? 'is-urgent' : ''}`}>
                <span className="fam-dot" aria-hidden />
                <span className="fam-action-text">{a.text}</span>
                <Link className="fam-go" href={link(a.link)}>Open</Link>
              </li>
            ))}
            {data.actions.length > 6 && <li className="fam-more">+{data.actions.length - 6} more</li>}
          </ul>
        )}
      </div>

      <div className="fam-kids">
        {data.children.map((c) => {
          const t = TODAY[c.today] ?? { label: c.today, tone: 'gray' as const };
          return (
            <div key={c.studentId} className="fam-kid">
              <div className="fam-kid-head">
                <div>
                  <div className="fam-kid-name">{c.name}</div>
                  <div className="fam-kid-class">{c.className ?? '—'}{c.classTeacher ? ` · ${c.classTeacher}` : ''}</div>
                </div>
                <Pill tone={t.tone}>{t.label}</Pill>
              </div>
              <dl className="fam-facts">
                <div><dt>Attendance</dt><dd>{c.attendancePct != null ? `${c.attendancePct}%` : '—'}</dd></div>
                <div><dt>Homework due</dt><dd>{c.homeworkDue.length ? <Link href={link('/parent/assignments')}>{c.homeworkDue.length} · {c.homeworkDue[0].title}</Link> : 'None this week'}</dd></div>
                <div><dt>Fees</dt><dd>{c.pendingFeesPaise > 0 ? <Link href={link('/parent/payments')}>{rupees(c.pendingFeesPaise)} to pay</Link> : 'All paid'}</dd></div>
                <div><dt>Next exam</dt><dd>{c.nextExam ? `${c.nextExam.subject} · ${dayLabel(c.nextExam.on)}` : 'None scheduled'}</dd></div>
              </dl>
            </div>
          );
        })}
      </div>
      <p className="fam-hint">On WhatsApp, send <strong>Hi</strong> to the school number for this summary, or ask in your own language.</p>
    </section>
  );
}
