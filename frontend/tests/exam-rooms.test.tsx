import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { placementFor } from '@/lib/nav-spaces';
import opsRoutes from '@/lib/ops-routes.json';

/**
 * Part 8 screens: a family's own exam timetable (room and own seat), the exam
 * timetable with day-of banners, Rooms & Classes for a teacher (request, no
 * home-room change) and the administrator (assign), the shift check that
 * refuses a busy room and offers free ones, and where the pages sit in the sidebar.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/teacher/rooms-classes',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  myExams: vi.fn(), sittings: vi.fn(), duties: vi.fn(), rooms: vi.fn(), shifts: vi.fn(), checkShift: vi.fn(), createShift: vi.fn(), assignHome: vi.fn(),
}));
vi.mock('@/lib/exam-rooms-api', () => ({ examRoomsApi: api }));

const { MyExamsView, ExamScheduleView, RoomsClassesView } = await import('@/components/ops/exam-rooms-views');
const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const room = (id: string, name: string, capacity: number, occupant: { sectionId: string; className: string; strength: number } | null = null) => ({ id, code: id.toUpperCase(), name, kind: 'CLASSROOM', capacity, status: 'ACTIVE', occupant, fits: null, movedInToday: [] });
const roomsData = (canManage: boolean) => ({
  date: '2026-10-19', canManage, settings: { teacherSelfShift: false },
  totals: { classes: 1, withoutRoom: 0, overCapacity: 1, freeRooms: 1, shiftedToday: 0, pendingRequests: 0 },
  sections: [{ sectionId: 's7b', className: 'Class 7 B', strength: 42, classTeacher: 'Asha Rao', homeRoom: { id: 'r1', code: 'R1', name: 'Room 107', kind: 'CLASSROOM', capacity: 40 }, fits: false, spare: -2, shiftedToday: [] }],
  rooms: [room('r1', 'Room 107', 40, { sectionId: 's7b', className: 'Class 7 B', strength: 42 }), room('lab', 'Science Lab', 45)],
});

beforeEach(() => { vi.clearAllMocks(); });

describe('My exams', () => {
  it('shows each child\'s room and own seat, and the day-of banner', async () => {
    api.myExams.mockResolvedValue({ note: 'Your own exam timetable.', children: [{ studentId: 'k1', name: 'Rahul Sharma', className: 'Class 6 A', exams: [{ id: 'e1', title: 'Midterm · Mathematics', subject: 'Mathematics', kind: 'TERM', date: '2026-10-26', dateLabel: 'Mon 26 Oct', startTime: '10:00', endTime: '12:00', delayMinutes: 0, status: 'SCHEDULED', room: 'Auditorium', seatNo: 'AUD-07', banner: 'Moved from Room 6A to Auditorium' }] }] });
    inApp(<MyExamsView />);
    expect(await screen.findByText('Auditorium · seat AUD-07')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Moved from Room 6A to Auditorium/);
  });
});

describe('Exam timetable', () => {
  it('lists papers with rooms, invigilators and unseated candidates; a teacher schedules class tests only', async () => {
    api.sittings.mockResolvedValue({ from: '2026-10-19', to: '2026-12-18', canSchedule: 'CLASS_TEST', items: [{ id: 'x1', kind: 'TERM', title: 'Midterm · Mathematics', subject: 'Mathematics', examSubjectId: null, classes: [{ sectionId: 's', className: 'Class 10 A' }], date: '2026-10-26', dateLabel: 'Mon 26 Oct', startTime: '10:00', endTime: '12:00', delayMinutes: 0, startsAt: '10:00', endsAt: '12:00', status: 'SCHEDULED', banner: null, notes: null, candidates: 41, seated: 40, unseated: 1, venues: [{ id: 'v', facilityId: 'f', room: 'Auditorium', code: 'AUD', capacity: 40, seated: 40, invigilators: [{ id: 'p', name: 'Sunita Rao' }] }], canEdit: false }] });
    inApp(<ExamScheduleView />);
    expect(await screen.findByText(/Auditorium \(40\/40\) · Sunita Rao/)).toBeTruthy();
    expect(screen.getByText('1 candidates without a seat')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Schedule a class test' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change room' })).toBeNull();
  });
});

describe('Rooms & Classes', () => {
  it('a teacher can request a move but not change a home room', async () => {
    api.rooms.mockResolvedValue(roomsData(false));
    inApp(<RoomsClassesView />);
    expect(await screen.findByText('Class 7 B · Room 107')).toBeTruthy();
    expect(screen.getAllByText('Over capacity').length).toBeGreaterThan(1); // the tile and the class's flag
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Request a room change' })).toBeTruthy();
  });

  it('the check refuses a busy room, offers free rooms, and only then can be applied', async () => {
    api.rooms.mockResolvedValue(roomsData(true));
    api.checkShift.mockResolvedValue({ className: 'Class 7 B', sectionId: 's7b', strength: 42, from: null, to: { id: 'r1', code: 'R1', name: 'Room 107', kind: 'CLASSROOM', capacity: 40 }, kind: 'TEMPORARY', startDate: '2026-10-20', endDate: '2026-10-20', periods: [3], when: 'on Tue 20 Oct, period 3', lessons: 1, conflicts: [{ date: '2026-10-20', periodNo: 3, kind: 'EXAM', detail: 'Unit test (10:15–11:00)' }], warnings: [], fits: false, suggestions: [{ id: 'lab', code: 'LAB', name: 'Science Lab', kind: 'LAB', capacity: 45, fits: true }], canApply: true });
    inApp(<RoomsClassesView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move a class' }));
    const [, toRoom] = screen.getAllByRole('combobox');
    fireEvent.change(toRoom, { target: { value: 'r1' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Painting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/Unit test \(10:15–11:00\)/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply and tell everyone' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Science Lab · 45/ })).toBeTruthy();
    await waitFor(() => expect(api.createShift).not.toHaveBeenCalled());
  });
});

describe('sidebar placement', () => {
  it('puts the exam timetable with teaching, Rooms & Classes with operations, My exams with the child', () => {
    expect(placementFor('principal', 'exam-schedule', 'LEARNING')).toBe('teaching');
    expect(placementFor('teacher', 'rooms-classes', 'ADMINISTRATION')).toBe('operations');
    expect(placementFor('parent', 'my-exams', 'LEARNING')).toBe('child');
    const portals = opsRoutes.portals as Record<string, string[]>;
    expect(portals.teacher).toEqual(expect.arrayContaining(['exam-schedule', 'rooms-classes']));
    expect(portals.parent).toContain('my-exams');
    expect(portals.parent).not.toContain('rooms-classes');
  });
});
