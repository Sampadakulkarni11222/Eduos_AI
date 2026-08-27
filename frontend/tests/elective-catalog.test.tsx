import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ElectiveCatalog } from '@/components/registrations/elective-catalog';
import { ToastProvider } from '@/components/ui';
import { api } from '@/lib/api';
import type { AvailableElectiveDto } from '@/lib/types';

/**
 * Regression cover for the busy-state bug: `busyId` is null when idle, and
 * `myRegistrationId` is null for any elective the student has not registered
 * for, so `busyId === e.myRegistrationId` was true for every unregistered row
 * and each Register button read "Sending…" permanently.
 */

const elective = (over: Partial<AvailableElectiveDto> = {}): AvailableElectiveDto => ({
  subjectOfferingId: 'off-1',
  subjectName: 'French',
  subjectCode: 'FRE',
  termName: 'Midterm',
  teacherName: 'Amit Joshi',
  capacity: 25,
  seatsTaken: 1,
  seatsLeft: 24,
  isFull: false,
  myRegistrationId: null,
  myStatus: null,
  myDecisionNote: null,
  ...over,
});

const renderCatalog = () => render(<ToastProvider><ElectiveCatalog /></ToastProvider>);

beforeEach(() => vi.restoreAllMocks());

describe('ElectiveCatalog — idle state', () => {
  it('shows a usable Register button on every unregistered elective', async () => {
    vi.spyOn(api, 'availableElectives').mockResolvedValue([
      elective({ subjectOfferingId: 'a', subjectName: 'French' }),
      elective({ subjectOfferingId: 'b', subjectName: 'Music' }),
      elective({ subjectOfferingId: 'c', subjectName: 'Dance', capacity: null, seatsLeft: null }),
    ]);
    vi.spyOn(api, 'myRegistrations').mockResolvedValue([]);

    renderCatalog();

    const buttons = await screen.findAllByRole('button', { name: 'Register' });
    expect(buttons).toHaveLength(3);
    // The bug: all three read "Sending…" and were disabled from first paint.
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    for (const b of buttons) expect(b).not.toBeDisabled();
  });

  it('does not mark rows busy just because nothing is in flight', async () => {
    vi.spyOn(api, 'availableElectives').mockResolvedValue([elective()]);
    vi.spyOn(api, 'myRegistrations').mockResolvedValue([]);

    renderCatalog();
    await screen.findByRole('button', { name: 'Register' });
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
  });
});

describe('ElectiveCatalog — mixed states', () => {
  it('shows Withdraw for a pending row and Register for the rest', async () => {
    vi.spyOn(api, 'availableElectives').mockResolvedValue([
      elective({ subjectOfferingId: 'a', subjectName: 'French', myRegistrationId: 'reg-1', myStatus: 'PENDING' }),
      elective({ subjectOfferingId: 'b', subjectName: 'Music' }),
    ]);
    vi.spyOn(api, 'myRegistrations').mockResolvedValue([]);

    renderCatalog();

    expect(await screen.findByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    // The other row must still be actionable — this is what regressed.
    expect(screen.getByRole('button', { name: 'Register' })).not.toBeDisabled();
  });

  it('shows Drop for an approved row', async () => {
    vi.spyOn(api, 'availableElectives').mockResolvedValue([
      elective({ myRegistrationId: 'reg-1', myStatus: 'APPROVED' }),
    ]);
    vi.spyOn(api, 'myRegistrations').mockResolvedValue([]);

    renderCatalog();
    expect(await screen.findByText('Registered')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drop' })).toBeInTheDocument();
  });

  it('marks a full elective as Full with no Register button', async () => {
    vi.spyOn(api, 'availableElectives').mockResolvedValue([
      elective({ isFull: true, seatsLeft: 0, seatsTaken: 25 }),
    ]);
    vi.spyOn(api, 'myRegistrations').mockResolvedValue([]);

    renderCatalog();
    expect(await screen.findByText('Full')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument();
  });
});

describe('ElectiveCatalog — registering', () => {
  it('shows Sending… only on the row being acted on', async () => {
    vi.spyOn(api, 'availableElectives').mockResolvedValue([
      elective({ subjectOfferingId: 'a', subjectName: 'French' }),
      elective({ subjectOfferingId: 'b', subjectName: 'Music' }),
    ]);
    vi.spyOn(api, 'myRegistrations').mockResolvedValue([]);
    // Never resolves, so the in-flight state stays observable.
    vi.spyOn(api, 'registerForElective').mockImplementation(() => new Promise(() => {}));

    renderCatalog();
    const buttons = await screen.findAllByRole('button', { name: 'Register' });
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(screen.getByText('Sending…')).toBeInTheDocument());
    // Exactly one row is busy; the other stays clickable.
    expect(screen.getAllByText('Sending…')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Register' })).not.toBeDisabled();
  });

  it('sends the offering id the student clicked', async () => {
    vi.spyOn(api, 'availableElectives').mockResolvedValue([
      elective({ subjectOfferingId: 'a', subjectName: 'French' }),
      elective({ subjectOfferingId: 'b', subjectName: 'Music' }),
    ]);
    vi.spyOn(api, 'myRegistrations').mockResolvedValue([]);
    const spy = vi.spyOn(api, 'registerForElective').mockResolvedValue({} as never);

    renderCatalog();
    const buttons = await screen.findAllByRole('button', { name: 'Register' });
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(spy).toHaveBeenCalledWith('b'));
  });
});

describe('ElectiveCatalog — empty and error states', () => {
  it('explains an empty catalogue', async () => {
    vi.spyOn(api, 'availableElectives').mockResolvedValue([]);
    vi.spyOn(api, 'myRegistrations').mockResolvedValue([]);

    renderCatalog();
    expect(await screen.findByText('No electives on offer')).toBeInTheDocument();
  });

  it('surfaces the server message when loading fails', async () => {
    vi.spyOn(api, 'availableElectives').mockRejectedValue(new Error('You are not enrolled in a class yet'));
    vi.spyOn(api, 'myRegistrations').mockRejectedValue(new Error('nope'));

    renderCatalog();
    expect(await screen.findByText(/not enrolled in a class yet/i)).toBeInTheDocument();
  });
});
