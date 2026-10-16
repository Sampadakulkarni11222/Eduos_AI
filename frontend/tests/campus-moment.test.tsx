import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CampusMomentDto, ShiftsDto, StaffCredentialDto } from '@/lib/ops-types';

/**
 * Campus World's day plan and the teacher profiles, on screen:
 *   - the banner says what the school day is doing at the moment shown
 *     (holiday, closed until when, a period with minutes left, each shift);
 *   - a teacher's profile shows families only the parts the teacher shared;
 *   - the shifts screen lists bells and classes, and asks before moving a
 *     class out of another shift;
 *   - a staff member sets "Show to families" per part; HR cannot change it.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/admin/shifts',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const opsApi = vi.hoisted(() => ({ shifts: vi.fn(), createShift: vi.fn(), updateShift: vi.fn(), retireShift: vi.fn(), myStaffProfile: vi.fn(), saveMyStaffProfile: vi.fn(), teachersOf: vi.fn() }));
vi.mock('@/lib/ops-api', () => ({ opsApi }));

const { MomentBanner, TeacherAbout } = await import('@/components/campus/campus-moment');
const { ShiftsView, CredentialsEditor, ChildTeachersCard } = await import('@/components/ops/p3-campus-views');
const { ApiError } = await import('@/lib/api');

const moment = (over: Partial<CampusMomentDto> = {}): CampusMomentDto => ({
  date: '2026-10-16', time: '10:48', dayOfWeek: 5, timezone: 'Asia/Kolkata', isToday: true, live: true,
  day: { kind: 'SCHOOL_DAY', title: null, open: true },
  banner: { text: 'Period 3 of 8, 12 min left', sub: null, tone: 'class', motion: true },
  nextOpen: null, shifts: [], sections: [], crowd: [], buses: { phase: 'PARKED', trips: 2, label: 'Buses parked in the bay' }, walkers: 'FEW', totals: null, source: '',
  ...over,
});

beforeEach(() => { for (const f of Object.values(opsApi)) f.mockReset(); });

describe('the day-plan banner', () => {
  it('names a holiday and when school opens', () => {
    render(<MomentBanner moment={moment({ day: { kind: 'HOLIDAY', title: 'Diwali', open: false }, banner: { text: 'Holiday: Diwali', sub: 'Opens Mon 19 Oct, 7:45 am', tone: 'holiday', motion: false }, buses: { phase: 'AWAY', trips: 0, label: '' } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Holiday: Diwali');
    expect(screen.getByRole('status')).toHaveTextContent('Opens Mon 19 Oct, 7:45 am');
    expect(screen.queryByText(/parked/)).toBeNull();
  });
  it('counts down a period, shows each shift, and says when a preview is not now', () => {
    render(<MomentBanner moment={moment({ live: false, time: '13:00', shifts: [
      { code: 'PRI', name: 'Primary', color: '#2BA39A', phase: 'AFTER', label: 'Day over', periodNo: null, periodsTotal: 5, minutesLeft: null, opensAt: '07:45', closesAt: '13:35', sections: 2 },
      { code: 'SEC', name: 'Secondary', color: null, phase: 'PERIOD', label: 'Period 5 of 8', periodNo: 5, periodsTotal: 8, minutesLeft: 15, opensAt: '08:00', closesAt: '16:05', sections: 10 },
    ] })} />);
    const b = screen.getByRole('status');
    expect(b).toHaveTextContent('Period 3 of 8, 12 min left');
    expect(b).toHaveTextContent('Primary: day over');
    expect(b).toHaveTextContent('Secondary: in lessons');
    expect(b).toHaveTextContent('Today 13:00');
    expect(b).toHaveTextContent('parked');
  });
  it('renders nothing without a day plan', () => {
    const { container } = render(<MomentBanner moment={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("a teacher's profile for families", () => {
  it('shows only the shared parts, and nothing when none is shared', () => {
    const { rerender, container } = render(<TeacherAbout about={{ name: 'Ms Rao', shown: [] }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TeacherAbout about={{ name: 'Ms Rao', shown: ['qualifications', 'experience'], qualifications: [{ degree: 'M.Sc. Mathematics', institution: 'Sample University', year: 2010 }], experienceYears: 13 }} />);
    expect(screen.getByText('M.Sc. Mathematics, Sample University, 2010')).toBeInTheDocument();
    expect(screen.getByText('13 years')).toBeInTheDocument();
    expect(screen.queryByText('About')).toBeNull();
  });
  it("lists the child's teachers on the parent's card", async () => {
    opsApi.teachersOf.mockResolvedValue({ studentId: 's1', child: 'Rahul', note: 'Each teacher chooses what is shown to families.', teachers: [
      { profileId: 't1', name: 'Ms Rao', teaches: ['Mathematics'], classTeacher: true, shown: ['certifications'], certifications: [{ name: 'CTET', issuer: 'CBSE', year: 2014 }] },
      { profileId: 't2', name: 'Mr Menon', teaches: ['Science'], classTeacher: false, shown: [] },
    ] });
    render(<ChildTeachersCard studentId="s1" />);
    expect(await screen.findByText("Rahul's teachers")).toBeInTheDocument();
    expect(screen.getByText('CTET 2014')).toBeInTheDocument();
    expect(screen.getByText('Mr Menon')).toBeInTheDocument();
    expect(opsApi.teachersOf).toHaveBeenCalledWith('s1');
  });
});

const SHIFTS: ShiftsDto = {
  shifts: [{ id: 'sh1', code: 'PRIMARY', name: 'Primary morning shift', color: '#2BA39A', active: true, daysOfWeek: [1, 2, 3, 4, 5, 6], periods: 1, startsAt: '07:45', endsAt: '09:15', note: null, updatedAt: null,
    bells: [{ kind: 'ASSEMBLY', label: 'Assembly', periodNo: null, start: '07:45', end: '08:05' }, { kind: 'PERIOD', label: null, periodNo: 1, start: '08:30', end: '09:15' }],
    sections: [{ id: 'a', name: 'Class 5 A' }] }],
  unassigned: [{ id: 'b', name: 'Class 6 A' }], sections: [{ id: 'a', name: 'Class 5 A' }, { id: 'b', name: 'Class 6 A' }],
  conflicts: [{ room: 'G01', day: 'Mon', dayOfWeek: 1, from: '08:30', to: '09:00', classes: ['Class 5 A (PRIMARY, period 1)', 'Class 6 A (SEC, period 1)'] }], bellKinds: [], note: '',
};

describe('the shifts screen', () => {
  it('lists bells, classes, unassigned classes and room clashes', async () => {
    opsApi.shifts.mockResolvedValue(SHIFTS);
    render(<ShiftsView />);
    expect(await screen.findByText('Primary morning shift')).toBeInTheDocument();
    expect(screen.getByText('Period 1')).toBeInTheDocument();
    expect(screen.getByText('Assembly')).toBeInTheDocument();
    expect(screen.getByText('Room clashes between shifts')).toBeInTheDocument();
    expect(screen.getByText('Classes without a shift')).toBeInTheDocument();
  });
  it('asks before moving a class that is in another shift, then moves it', async () => {
    opsApi.shifts.mockResolvedValue(SHIFTS);
    opsApi.createShift.mockRejectedValueOnce(new ApiError(409, 'SECTION_IN_OTHER_SHIFT', 'Class 5 A already belong to Primary morning shift. Move them to this shift?')).mockResolvedValueOnce({});
    render(<ShiftsView />);
    fireEvent.click(await screen.findByText('+ New shift'));
    fireEvent.change(screen.getByPlaceholderText('MORNING'), { target: { value: 'sec' } });
    fireEvent.change(screen.getByPlaceholderText('Primary morning shift'), { target: { value: 'Secondary' } });
    fireEvent.click(screen.getAllByRole('checkbox', { name: /Class 5 A/ })[0]);
    fireEvent.click(screen.getByText('Save shift'));
    expect(await screen.findByText(/already belong to Primary morning shift/)).toBeInTheDocument();
    expect(opsApi.createShift.mock.calls[0][0]).toMatchObject({ code: 'SEC', name: 'Secondary', sectionIds: ['a'], moveSections: false });
    fireEvent.click(screen.getByText('Move them to this shift'));
    await waitFor(() => expect(opsApi.createShift).toHaveBeenCalledTimes(2));
    expect(opsApi.createShift.mock.calls[1][0]).toMatchObject({ moveSections: true });
  });
});

const PROFILE: StaffCredentialDto = {
  profileId: 't1', name: 'Ms Rao', role: 'Teacher', qualifications: [{ degree: 'M.Sc.', institution: null, year: 2010 }], subjects: ['Mathematics'], specialisations: [], experienceYears: 12,
  certifications: [], bio: 'Hello', showToFamilies: { qualifications: false, subjects: false, experience: false, certifications: false, bio: false }, updatedAt: null,
  canEdit: true, canEditConsent: true, familiesSee: { name: 'Ms Rao', shown: [] },
};

describe('the professional profile', () => {
  it('saves the "Show to families" choice the person makes', async () => {
    const save = vi.fn().mockResolvedValue(PROFILE);
    render(<CredentialsEditor profile={PROFILE} save={save} onSaved={() => {}} />);
    expect(screen.getByText('Nothing: every part is private.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Show to families' })[2]);
    fireEvent.click(screen.getByText('Save profile'));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({ experienceYears: 12, showToFamilies: { experience: true, bio: false } });
  });
  it('HR may edit details but not the consent, and none is sent', async () => {
    const save = vi.fn().mockResolvedValue(PROFILE);
    render(<CredentialsEditor profile={{ ...PROFILE, canEditConsent: false }} save={save} onSaved={() => {}} />);
    for (const box of screen.getAllByRole('checkbox', { name: 'Show to families' })) expect(box).toBeDisabled();
    fireEvent.click(screen.getByText('Save profile'));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].showToFamilies).toBeUndefined();
  });
});
