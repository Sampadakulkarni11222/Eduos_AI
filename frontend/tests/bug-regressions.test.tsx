import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { normaliseLeadPhone } from '@/lib/phone';

/**
 * The three forms behind BUG-01, BUG-03 and BUG-04, driven as a user would.
 *
 * The shell is replaced (it needs the router, auth and theme providers and is
 * not under test) by one that renders the page and its top-bar actions; the
 * API is replaced so the tests can see exactly what each form sends.
 */

const api = vi.hoisted(() => ({
  hostelRooms: vi.fn(),
  hostelAllocations: vi.fn(),
  students: vi.fn(),
  createHostelRoom: vi.fn(),
  pipeline: vi.fn(),
  createLead: vi.fn(),
  listUsersPage: vi.fn(),
  mySections: vi.fn(),
  allSections: vi.fn(),
  createUser: vi.fn(),
}));

vi.mock('@/lib/api', () => {
  class ApiError extends Error {}
  return {
    api,
    ApiError,
    errorMessage: (err: unknown, fallback: string) => (err instanceof Error && err.message) || fallback,
  };
});

vi.mock('@/components/shell', () => ({
  PortalShell: ({ topbar, children }: { topbar?: { actions?: ReactNode }; children: ReactNode }) => (
    <div>{topbar?.actions}{children}</div>
  ),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ me: { profile: { id: 'p1', role: 'ADMIN' } } }),
}));

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ permissions: {}, hasAccess: () => true }),
}));

const { default: WardenRooms } = await import('@/app/[school]/warden/rooms/page');
const { default: AdmissionsPage } = await import('@/app/[school]/admin/admissions/page');
const { default: UsersPage } = await import('@/app/[school]/admin/users/page');

const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  api.hostelRooms.mockResolvedValue([]);
  api.hostelAllocations.mockResolvedValue([]);
  api.students.mockResolvedValue({ items: [] });
  api.createHostelRoom.mockResolvedValue({});
  api.pipeline.mockResolvedValue({ stages: [], byStage: {} });
  api.createLead.mockResolvedValue({ id: 'l1' });
  api.listUsersPage.mockResolvedValue({ items: [], total: 0, totalPages: 1, page: 1 });
  api.mySections.mockResolvedValue([]);
  api.allSections.mockResolvedValue([]);
  api.createUser.mockResolvedValue({});
});

describe('BUG-01: Add Room sends a room type the backend accepts', () => {
  const openForm = async () => {
    inApp(<WardenRooms />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Room' }));
    const form = screen.getByText('Add Hostel Room').closest('.modal') as HTMLElement;
    fireEvent.change(within(form).getByPlaceholderText('e.g. 104'), { target: { value: '104' } });
    return form;
  };

  it('offers only the backend room types, and no AC / NON_AC type', async () => {
    const form = await openForm();
    const options = within(within(form).getByLabelText('Room Type')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['GENERAL', 'BOYS', 'GIRLS', 'STAFF']);
  });

  it('sends a non-AC room with a valid type and no AC amenity', async () => {
    const form = await openForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Add Room' }));
    await waitFor(() => expect(api.createHostelRoom).toHaveBeenCalled());
    expect(api.createHostelRoom).toHaveBeenCalledWith({ roomNo: '104', block: 'Block A', capacity: 2, type: 'GENERAL', amenities: [] });
  });

  it('sends an AC room as the AC amenity', async () => {
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('Room Type'), { target: { value: 'GIRLS' } });
    fireEvent.click(within(form).getByLabelText('Air conditioned (AC)'));
    fireEvent.click(within(form).getByRole('button', { name: 'Add Room' }));
    await waitFor(() => expect(api.createHostelRoom).toHaveBeenCalled());
    expect(api.createHostelRoom.mock.calls[0][0]).toMatchObject({ type: 'GIRLS', amenities: ['AC'] });
  });
});

describe('BUG-03: New Lead refuses a phone the backend would refuse', () => {
  it.each([
    ['+919876543210', '+919876543210'],
    ['9876543210', '9876543210'],
    [' +91 98765-43210 ', '+919876543210'],
    ['+14155552671', '+14155552671'],
  ])('normalises %j to %j', (input, out) => {
    expect(normaliseLeadPhone(input)).toBe(out);
  });

  it.each(['+91', '', '   ', 'abcdefghij', '987654321', '+91987654321', '+1234567890123456', '98+76543210'])(
    'rejects %j', (input) => {
      expect(normaliseLeadPhone(input)).toBeNull();
    },
  );

  const openForm = async () => {
    inApp(<AdmissionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add lead' }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Asha' } });
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Meera' } });
  };

  it('does not submit the untouched "+91" prefill', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    expect(await screen.findByText(/Enter a valid phone number/)).toBeTruthy();
    expect(api.createLead).not.toHaveBeenCalled();
  });

  it('submits a valid number in its stored form', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+91 98765 43210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    await waitFor(() => expect(api.createLead).toHaveBeenCalled());
    expect(api.createLead.mock.calls[0][0]).toMatchObject({ childName: 'Asha', guardianName: 'Meera', phoneE164: '+919876543210' });
  });

  it("shows the server's reason when it refuses", async () => {
    api.createLead.mockRejectedValueOnce(new Error('phone must be a valid number'));
    await openForm();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+919876543210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    expect(await screen.findByText('phone must be a valid number')).toBeTruthy();
  });
});

describe('BUG-04: Create User offers the staff roles the backend supports', () => {
  const openModal = async () => {
    inApp(<UsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add User' }));
    return screen.getByText('Create User Profile').closest('.modal') as HTMLElement;
  };

  it('lists student, teacher and every non-admin staff role, but not ADMIN or PARENT', async () => {
    const modal = await openModal();
    const options = within(within(modal).getByLabelText('Select Role')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['STUDENT', 'TEACHER', 'PRINCIPAL', 'FINANCE', 'LIBRARIAN', 'WARDEN']);
  });

  it.each(['PRINCIPAL', 'FINANCE', 'LIBRARIAN', 'WARDEN'])('creates a %s without student-only fields', async (roleKey) => {
    const modal = await openModal();
    fireEvent.change(within(modal).getByLabelText('Select Role'), { target: { value: roleKey } });
    expect(within(modal).queryByText('Admission Number (Optional)')).toBeNull();
    fireEvent.change(within(modal).getByPlaceholderText('e.g. Diya Tharian'), { target: { value: 'Staff Member' } });
    fireEvent.change(within(modal).getByPlaceholderText('e.g. +919555000111'), { target: { value: '+919555000111' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Create User' }));
    await waitFor(() => expect(api.createUser).toHaveBeenCalled());
    expect(api.createUser.mock.calls[0][0]).toMatchObject({ roleKey, displayName: 'Staff Member', phone: '+919555000111', admissionNo: undefined, sectionId: undefined });
  });
});
