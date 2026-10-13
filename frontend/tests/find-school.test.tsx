import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FindSchool } from '@/components/find-school';
import { ApiError, api } from '@/lib/api';
import SchoolEntryPage from '@/app/[school]/page';

/**
 * The school finder: who is sent where, and what the form does with each
 * answer. It must only ever end at a school's ordinary sign-in door — it
 * signs nobody in and opens no portal for anyone who is not already signed in.
 */

const replace = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, prefetch: vi.fn(), back: vi.fn() }),
  useParams: () => ({ school: 'oakridge' }),
}));

let auth: { loading: boolean; me: unknown } = { loading: false, me: null };
vi.mock('@/lib/auth', () => ({ useAuth: () => auth }));

const visit = (url: string) => window.history.pushState({}, '', url);
const input = () => screen.getByLabelText('School code');
const submit = (value: string) => {
  fireEvent.change(input(), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
};

beforeEach(() => {
  vi.restoreAllMocks();
  replace.mockReset();
  push.mockReset();
  localStorage.clear();
  auth = { loading: false, me: null };
  visit('/find-school');
});

describe('arriving', () => {
  it('waits for the session check before deciding anything', () => {
    auth = { loading: true, me: null };
    localStorage.setItem('eduos.lastSchool', 'oakridge');
    render(<FindSchool />);
    expect(screen.queryByLabelText('School code')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends a signed-in user to their own portal', () => {
    auth = { loading: false, me: { profile: { id: 'p1', role: 'STUDENT', tenantId: 'oakridge' } } };
    // Even with another school remembered: the profile decides, not the device.
    localStorage.setItem('eduos.lastSchool', 'nvmp');
    render(<FindSchool />);
    expect(replace).toHaveBeenCalledWith('/oakridge/student');
    expect(screen.queryByLabelText('School code')).toBeNull();
  });

  it('sends a returning device to its school’s sign-in door', () => {
    localStorage.setItem('eduos.lastSchool', 'oakridge');
    render(<FindSchool />);
    expect(replace).toHaveBeenCalledWith('/oakridge');
  });

  it('shows the form to a new visitor', () => {
    render(<FindSchool />);
    expect(input()).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the form, and forgets the school, when changing school', () => {
    localStorage.setItem('eduos.lastSchool', 'oakridge');
    visit('/find-school?change=1');
    render(<FindSchool />);
    expect(input()).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(localStorage.getItem('eduos.lastSchool')).toBeNull();
  });
});

describe('looking a school up', () => {
  it('opens the school’s sign-in door and remembers it', async () => {
    const spy = vi.spyOn(api, 'publicSchool').mockResolvedValue({ slug: 'oakridge', name: 'Oakridge Academy' });
    render(<FindSchool />);
    submit('  Oakridge ');

    await waitFor(() => expect(push).toHaveBeenCalledWith('/oakridge'));
    expect(spy).toHaveBeenCalledWith('oakridge');
    expect(localStorage.getItem('eduos.lastSchool')).toBe('oakridge');
    // The door, never a portal: signing in is still to come.
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('accepts the school’s link pasted whole', async () => {
    const spy = vi.spyOn(api, 'publicSchool').mockResolvedValue({ slug: 'oakridge', name: 'Oakridge Academy' });
    render(<FindSchool />);
    submit('https://app.example.com/oakridge/student');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/oakridge'));
    expect(spy).toHaveBeenCalledWith('oakridge');
  });

  it.each([[''], ['oak ridge'], ['../admin'], ['super-admin'], ['login']])(
    'refuses %j without asking the server or navigating',
    async (value) => {
      const spy = vi.spyOn(api, 'publicSchool');
      render(<FindSchool />);
      submit(value);
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(input()).toHaveAttribute('aria-invalid', 'true');
      expect(spy).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    },
  );

  it('says when no school has that code, and stays on the form', async () => {
    vi.spyOn(api, 'publicSchool').mockRejectedValue(new ApiError(404, 'ERROR', 'School not found'));
    render(<FindSchool />);
    submit('nosuch');

    expect(await screen.findByRole('alert')).toHaveTextContent(/no school uses the code "nosuch"/i);
    expect(push).not.toHaveBeenCalled();
    expect(localStorage.getItem('eduos.lastSchool')).toBeNull();
    // The form is usable again for another try.
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
  });

  it('says when a school is unavailable, without opening its door', async () => {
    vi.spyOn(api, 'publicSchool').mockRejectedValue(new ApiError(403, 'SCHOOL_SUSPENDED', 'This school is not active'));
    render(<FindSchool />);
    submit('closed');

    expect(await screen.findByRole('alert')).toHaveTextContent(/not available right now/i);
    expect(push).not.toHaveBeenCalled();
    expect(localStorage.getItem('eduos.lastSchool')).toBeNull();
  });

  it('says when the server cannot be reached', async () => {
    vi.spyOn(api, 'publicSchool').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<FindSchool />);
    submit('oakridge');
    expect(await screen.findByRole('alert')).toHaveTextContent(/check your connection/i);
    expect(push).not.toHaveBeenCalled();
  });

  it('does not send a second lookup while one is in flight', async () => {
    const spy = vi.spyOn(api, 'publicSchool').mockImplementation(() => new Promise(() => {}));
    render(<FindSchool />);
    submit('oakridge');
    const button = await screen.findByRole('button', { name: 'Looking up…' });
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest('form')!);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('a remembered school whose door no longer opens', () => {
  it('is forgotten when the server says there is no such school, and the finder is offered', async () => {
    localStorage.setItem('eduos.lastSchool', 'oakridge');
    vi.spyOn(api, 'publicSchool').mockRejectedValue(new ApiError(404, 'ERROR', 'School not found'));
    render(<SchoolEntryPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Find your school' }));
    expect(replace).toHaveBeenCalledWith('/find-school?change=1');
    // Otherwise every launch of the app would land on this dead end again.
    expect(localStorage.getItem('eduos.lastSchool')).toBeNull();
  });

  it('is kept when the lookup merely failed to reach the server', async () => {
    localStorage.setItem('eduos.lastSchool', 'oakridge');
    vi.spyOn(api, 'publicSchool').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SchoolEntryPage />);

    await screen.findByRole('button', { name: 'Find your school' });
    expect(localStorage.getItem('eduos.lastSchool')).toBe('oakridge');
  });

  it('leaves a different remembered school alone', async () => {
    localStorage.setItem('eduos.lastSchool', 'nvmp');
    vi.spyOn(api, 'publicSchool').mockRejectedValue(new ApiError(404, 'ERROR', 'School not found'));
    render(<SchoolEntryPage />);

    await screen.findByRole('button', { name: 'Find your school' });
    expect(localStorage.getItem('eduos.lastSchool')).toBe('nvmp');
  });
});
