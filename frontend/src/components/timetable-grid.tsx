'use client';
import { useEffect, useState } from 'react';
import { Card, EmptyState, SkeletonRows, Button, useToast } from './ui';
import { api } from '@/lib/api';
import type { SectionDto, TimetableDto, OfferingDto } from '@/lib/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function TimetableGrid({ scopeLabel, canEdit = false }: { scopeLabel: string; canEdit?: boolean }) {
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [selectedGrade, setSelectedGrade] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [tt, setTt] = useState<TimetableDto | null>(null);
  const [loading, setLoading] = useState(false);

  // Edit / Add Slot states
  const [offerings, setOfferings] = useState<OfferingDto[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [periodNo, setPeriodNo] = useState(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:45');
  const [subjectOfferingId, setSubjectOfferingId] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const loadTimetable = () => {
    if (!sectionId) return;
    setLoading(true);
    api.timetable(sectionId).then(setTt).catch(() => setTt(null)).finally(() => setLoading(false));
  };

  useEffect(() => {
    api.mySections().then((s) => {
      setSections(s);
      if (s[0]) {
        setSelectedGrade(s[0].gradeName);
        setSectionId(s[0].id);
      }
    }).catch(() => setSections([]));

    if (canEdit) {
      api.myOfferings().then(setOfferings).catch(() => {});
    }
  }, [canEdit]);

  useEffect(() => {
    loadTimetable();
  }, [sectionId]);

  // Derive unique grade names preserving insertion order
  const grades = sections
    ? Array.from(new Map(sections.map((s) => [s.gradeName, s.gradeName])).values())
    : [];

  // Sections that belong to the currently selected grade
  const filteredSections = sections?.filter((s) => s.gradeName === selectedGrade) ?? [];

  const handleGradeChange = (grade: string) => {
    setSelectedGrade(grade);
    const first = sections?.find((s) => s.gradeName === grade);
    setSectionId(first?.id ?? '');
  };

  const periods = tt ? Array.from(new Set(tt.slots.map((s) => s.periodNo))).sort((a, b) => a - b) : [];
  const usedDays = tt ? Array.from(new Set(tt.slots.map((s) => s.dayOfWeek))).sort((a, b) => a - b) : [];
  const cell = (day: number, period: number) => tt?.slots.find((s) => s.dayOfWeek === day && s.periodNo === period);

  const handleCellClick = (day: number, period: number) => {
    if (!canEdit) return;
    const existing = cell(day, period);
    setDayOfWeek(day);
    setPeriodNo(period);
    if (existing) {
      setStartTime(existing.startTime);
      setEndTime(existing.endTime);
      setSubjectOfferingId(existing.subjectOfferingId || '');
    } else {
      setStartTime('09:00');
      setEndTime('09:45');
      setSubjectOfferingId('');
    }
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sectionId) return;
    setBusy(true);
    try {
      await api.upsertTimetableSlot({
        sectionId,
        dayOfWeek,
        periodNo,
        startTime,
        endTime,
        subjectOfferingId: subjectOfferingId || null,
      });
      setShowModal(false);
      loadTimetable();
    } catch (err: any) {
      toast(err.message || 'Could not save the timetable slot.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Filter offerings for the currently selected section
  const sectionOfferings = offerings.filter((o) => o.sectionId === sectionId);

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', flex: '1 1 auto' }}>
          {/* Grade Selector */}
          <div style={{ minWidth: 140, flex: '1 1 160px', maxWidth: 220 }}>
            <select
              className="input"
              value={selectedGrade}
              onChange={(e) => handleGradeChange(e.target.value)}
              aria-label="Grade"
              style={{ width: '100%' }}
            >
              {sections === null && <option>Loading…</option>}
              {grades.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          {/* Section Selector */}
          <div style={{ minWidth: 120, flex: '1 1 140px', maxWidth: 200 }}>
            <select
              className="input"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              aria-label="Section"
              style={{ width: '100%' }}
            >
              {filteredSections.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
        {canEdit && sectionId && (
          <Button onClick={() => {
            setDayOfWeek(1);
            setPeriodNo(1);
            setStartTime('09:00');
            setEndTime('09:45');
            setSubjectOfferingId('');
            setShowModal(true);
          }}>
            Add Timetable Slot
          </Button>
        )}
      </div>

      {sections === null && <Card><SkeletonRows rows={5} /></Card>}
      {sections?.length === 0 && <EmptyState title="No timetable yet" sub={`${scopeLabel} appear here once the timetable is built.`} />}
      {loading && <Card><SkeletonRows rows={5} /></Card>}
      {!loading && tt && periods.length === 0 && (
        <EmptyState title="Empty timetable" sub="No periods configured for this section yet." />
      )}
      {!loading && tt && periods.length > 0 && (
        <Card pad={false}>
          <div className="table-scroll-desktop" style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Day</th>
                  {periods.map((p) => <th key={p}>Period {p}</th>)}
                </tr>
              </thead>
              <tbody>
                {usedDays.map((dow) => (
                  <tr key={dow}>
                    <td className="cell-primary">{DAYS[dow - 1] ?? `Day ${dow}`}</td>
                    {periods.map((p) => {
                      const c = cell(dow, p);
                      return (
                        <td
                          key={p}
                          onClick={() => handleCellClick(dow, p)}
                          style={{ cursor: canEdit ? 'pointer' : 'default', transition: 'background 0.2s' }}
                          className={canEdit ? 'hover-bg' : ''}
                        >
                          {c && !c.isBreak ? (
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 12.5 }}>{c.subject}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{c.teacher ?? '—'}</div>
                              <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>{c.startTime} - {c.endTime}</div>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-faint)' }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: one day per card, periods listed top-to-bottom — a day x
              period matrix can't stack into the generic data-table-cards
              layout, so it gets its own agenda-style view instead. */}
          <div className="table-scroll-mobile">
            {usedDays.map((dow) => (
              <div key={dow} style={{ borderTop: '1px solid var(--hairline)', padding: '12px 16px' }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{DAYS[dow - 1] ?? `Day ${dow}`}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {periods.map((p) => {
                    const c = cell(dow, p);
                    return (
                      <div
                        key={p}
                        onClick={() => handleCellClick(dow, p)}
                        className={canEdit ? 'hover-bg' : ''}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                          padding: '8px 10px', borderRadius: 8, cursor: canEdit ? 'pointer' : 'default',
                          background: 'rgba(0,0,0,.015)',
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>P{p}</span>
                        {c && !c.isBreak ? (
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 12.5 }}>{c.subject}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{c.teacher ?? '—'} · {c.startTime}-{c.endTime}</div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-faint)' }}>—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Configure Timetable Slot</div>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="field-label">Day of Week *</div>
              <select className="field-input" value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
                {DAYS.map((name, index) => (
                  <option key={index} value={index + 1}>{name}</option>
                ))}
              </select>

              <div className="field-label">Period Number (1 - 12) *</div>
              <input className="field-input" type="number" required min={1} max={12} value={periodNo} onChange={(e) => setPeriodNo(Number(e.target.value))} />

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div className="field-label">Start Time (HH:MM) *</div>
                  <input className="field-input" type="text" required pattern="^\d{2}:\d{2}$" placeholder="09:00" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="field-label">End Time (HH:MM) *</div>
                  <input className="field-input" type="text" required pattern="^\d{2}:\d{2}$" placeholder="09:45" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>

              <div className="field-label">Subject Offering (Select blank for Break)</div>
              <select className="field-input" value={subjectOfferingId} onChange={(e) => setSubjectOfferingId(e.target.value)}>
                <option value="">-- Mark as Break / Free Period --</option>
                {sectionOfferings.map((o) => (
                  <option key={o.id} value={o.id}>{o.subject}</option>
                ))}
              </select>

              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Slot'}</Button>
                <Button variant="ghost" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
