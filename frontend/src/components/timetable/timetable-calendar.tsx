'use client';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, SkeletonRows, clickable, subjectColor } from '../ui';
import { api } from '@/lib/api';
import type { SectionDto, TimetableDto, OfferingDto, TimetableSlotDto } from '@/lib/types';
import { MonthView } from './month-view';
import { WeekView } from './week-view';
import { DayView } from './day-view';
import { ClassDetailModal } from './class-detail-modal';
import { SlotEditorModal } from './slot-editor-modal';
import { addDays, addMonths, addWeeks, formatMonthLabel, formatWeekRangeLabel, buildWeekDates, toDow, formatDayLabel, formatSingleDayLabel } from '@/lib/timetable-dates';

type ViewMode = 'month' | 'week' | 'day';

export function TimetableCalendar({ scopeLabel, canEdit = false }: { scopeLabel: string; canEdit?: boolean }) {
  const [sections, setSections] = useState<SectionDto[] | null>(null);
  const [selectedGrade, setSelectedGrade] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [tt, setTt] = useState<TimetableDto | null>(null);
  const [loading, setLoading] = useState(false);

  const [offerings, setOfferings] = useState<OfferingDto[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [anchorDate, setAnchorDate] = useState(() => new Date());

  const [detailSlot, setDetailSlot] = useState<TimetableSlotDto | null>(null);
  const [dayAgendaDate, setDayAgendaDate] = useState<Date | null>(null);
  const [editorState, setEditorState] = useState<{ dayOfWeek: number; periodNo: number; existing: TimetableSlotDto | null; startTime?: string; endTime?: string } | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  useEffect(() => {
    loadTimetable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  const grades = sections
    ? Array.from(new Map(sections.map((s) => [s.gradeName, s.gradeName])).values())
    : [];
  const filteredSections = sections?.filter((s) => s.gradeName === selectedGrade) ?? [];
  const sectionName = filteredSections.find((s) => s.id === sectionId)?.name ?? '';
  const division = selectedGrade ? `${selectedGrade} ${sectionName}`.trim() : '';

  const handleGradeChange = (grade: string) => {
    setSelectedGrade(grade);
    const first = sections?.find((s) => s.gradeName === grade);
    setSectionId(first?.id ?? '');
  };

  const goToday = () => setAnchorDate(new Date());
  const step = (dir: -1 | 1) => setAnchorDate((d) =>
    viewMode === 'month' ? addMonths(d, dir) : viewMode === 'week' ? addWeeks(d, dir) : addDays(d, dir));
  const goPrev = () => step(-1);
  const goNext = () => step(1);

  const sectionOfferings = offerings.filter((o) => o.sectionId === sectionId);
  const slots = tt?.slots ?? [];

  const openAddSlot = () => setEditorState({ dayOfWeek: 1, periodNo: 1, existing: null });

  const dayAgendaSlots = dayAgendaDate
    ? slots.filter((s) => s.dayOfWeek === toDow(dayAgendaDate) && !s.isBreak).sort((a, b) => a.periodNo - b.periodNo)
    : [];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', flex: '1 1 auto' }}>
          <div style={{ minWidth: 140, flex: '1 1 160px', maxWidth: 220 }}>
            <select className="input" value={selectedGrade} onChange={(e) => handleGradeChange(e.target.value)} aria-label="Grade" style={{ width: '100%' }}>
              {sections === null && <option>Loading…</option>}
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 120, flex: '1 1 140px', maxWidth: 200 }}>
            <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Section" style={{ width: '100%' }}>
              {filteredSections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        {canEdit && sectionId && (
          <Button onClick={openAddSlot}>Add Timetable Slot</Button>
        )}
      </div>

      {sections === null && <Card><SkeletonRows rows={5} /></Card>}
      {sections?.length === 0 && <EmptyState title="No timetable yet" sub={`${scopeLabel} appear here once the timetable is built.`} />}

      {sections && sections.length > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div className="tabs">
              <button className={`tab ${viewMode === 'day' ? 'active' : ''}`} onClick={() => setViewMode('day')}>Day</button>
              <button className={`tab ${viewMode === 'week' ? 'active' : ''}`} onClick={() => setViewMode('week')}>Week</button>
              <button className={`tab ${viewMode === 'month' ? 'active' : ''}`} onClick={() => setViewMode('month')}>Month</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Button variant="ghost" small onClick={goPrev}>‹ Prev</Button>
              <Button variant="soft" small onClick={goToday}>Today</Button>
              <Button variant="ghost" small onClick={goNext}>Next ›</Button>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 16, minWidth: 150, textAlign: 'center' }}>
                {viewMode === 'month'
                  ? formatMonthLabel(anchorDate)
                  : viewMode === 'week'
                    ? formatWeekRangeLabel(buildWeekDates(anchorDate))
                    : formatSingleDayLabel(anchorDate)}
              </strong>
            </div>
          </div>

          {loading && <Card><SkeletonRows rows={5} /></Card>}
          {!loading && (
            <Card pad={false} style={{ padding: 14 }}>
              {viewMode === 'month' ? (
                <MonthView anchorDate={anchorDate} slots={slots} onDayClick={setDayAgendaDate} />
              ) : viewMode === 'day' ? (
                <DayView
                  anchorDate={anchorDate}
                  slots={slots}
                  canEdit={canEdit}
                  onSlotClick={setDetailSlot}
                  onCellClick={(dayOfWeek, periodNo, existing, startTime, endTime) => setEditorState({ dayOfWeek, periodNo, existing, startTime, endTime })}
                />
              ) : (
                <WeekView
                  anchorDate={anchorDate}
                  slots={slots}
                  canEdit={canEdit}
                  onSlotClick={setDetailSlot}
                  onCellClick={(dayOfWeek, periodNo, existing, startTime, endTime) => setEditorState({ dayOfWeek, periodNo, existing, startTime, endTime })}
                />
              )}
            </Card>
          )}
        </>
      )}

      {dayAgendaDate && (
        // Backdrop dismissal is a mouse convenience; ModalA11yBridge supplies
        // Escape-to-close and a focus trap, and a backdrop must not be a tab stop.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && (() => setDayAgendaDate(null))()}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{formatDayLabel(dayAgendaDate)}</div>
              <button className="modal-close" aria-label="Close dialog" title="Close" onClick={() => setDayAgendaDate(null)}>×</button>
            </div>
            {dayAgendaSlots.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-2b)' }}>No classes scheduled on this day.</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dayAgendaSlots.map((s) => {
                const color = subjectColor(s.subject);
                return (
                  <div
                    key={s.id}
                    {...clickable(() => {
                      if (canEdit) { setEditorState({ dayOfWeek: s.dayOfWeek, periodNo: s.periodNo, existing: s }); }
                      else { setDetailSlot(s); }
                      setDayAgendaDate(null);
                    }, { label: `${s.subject ?? 'Class'} at ${s.startTime}` })}
                    className="hover-bg"
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: color.bg }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color.dot, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: color.text }}>{s.subject}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{s.startTime}-{s.endTime}{s.room ? ` · ${s.room}` : ''}</div>
                    </div>
                  </div>
                );
              })}
              {canEdit && (
                <Button
                  variant="ghost"
                  small
                  type="button"
                  onClick={() => { setEditorState({ dayOfWeek: toDow(dayAgendaDate), periodNo: 1, existing: null }); setDayAgendaDate(null); }}
                >
                  + Add slot for this day
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {detailSlot && (
        <ClassDetailModal slot={detailSlot} division={division} onClose={() => setDetailSlot(null)} />
      )}

      {editorState && sectionId && (
        <SlotEditorModal
          sectionId={sectionId}
          sectionOfferings={sectionOfferings}
          initialDayOfWeek={editorState.dayOfWeek}
          initialPeriodNo={editorState.periodNo}
          initialStartTime={editorState.startTime}
          initialEndTime={editorState.endTime}
          existing={editorState.existing}
          onClose={() => setEditorState(null)}
          onSaved={() => { setEditorState(null); loadTimetable(); }}
        />
      )}
    </>
  );
}
