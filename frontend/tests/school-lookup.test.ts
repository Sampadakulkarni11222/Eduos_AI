import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { forgetSchool, lookupSchool, parseSchoolCode, recallSchool, rememberSchool } from '@/lib/school-lookup';

/**
 * The rules behind the school finder: what counts as a school code, and what
 * each answer from the public school endpoint means to the person typing.
 */

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('parseSchoolCode', () => {
  it.each([
    ['oakridge', 'oakridge'],
    ['  Oakridge  ', 'oakridge'],
    ['abc-public-school', 'abc-public-school'],
    ['nvmp2', 'nvmp2'],
  ])('accepts the code %j', (input, slug) => {
    expect(parseSchoolCode(input)).toEqual({ ok: true, slug });
  });

  it.each([
    ['https://app.example.com/oakridge', 'oakridge'],
    ['https://app.example.com/oakridge/student/timetable?x=1#top', 'oakridge'],
    ['app.example.com/oakridge/', 'oakridge'],
    ['localhost:3000/oakridge', 'oakridge'],
    ['/oakridge', 'oakridge'],
    ['oakridge/student', 'oakridge'],
  ])('takes the school from a pasted link %j', (input, slug) => {
    expect(parseSchoolCode(input)).toEqual({ ok: true, slug });
  });

  it.each([
    [''],
    ['   '],
    ['a'], // too short for the backend's slug rule
    ['-oakridge'],
    ['oak ridge'],
    ['oak_ridge'],
    ['oakridge.school'],
    ['../admin'],
    ['<script>'],
    ['%2e%2e'],
    ['x'.repeat(65)],
  ])('rejects %j without naming a school', (input) => {
    expect(parseSchoolCode(input).ok).toBe(false);
  });

  it.each([['login'], ['super-admin'], ['api'], ['public'], ['select-profile'], ['find-school'], ['https://app.example.com/super-admin/schools']])(
    'rejects the app’s own route %j',
    (input) => {
      expect(parseSchoolCode(input).ok).toBe(false);
    },
  );

  it('says so when a link has no school in it', () => {
    const parsed = parseSchoolCode('https://www.abcschool.com/');
    expect(parsed).toEqual({ ok: false, message: expect.stringMatching(/does not name a school/i) });
  });
});

describe('lookupSchool', () => {
  it('returns the school the server found', async () => {
    const school = { slug: 'oakridge', name: 'Oakridge Academy' };
    const spy = vi.spyOn(api, 'publicSchool').mockResolvedValue(school);
    await expect(lookupSchool('oakridge')).resolves.toEqual({ status: 'found', school });
    expect(spy).toHaveBeenCalledWith('oakridge');
  });

  it('reports an unknown code as not found', async () => {
    vi.spyOn(api, 'publicSchool').mockRejectedValue(new ApiError(404, 'ERROR', 'School not found'));
    const result = await lookupSchool('nosuch');
    expect(result.status).toBe('not-found');
    expect(result).toHaveProperty('message', expect.stringContaining('nosuch'));
  });

  it('reports a suspended school as unavailable, not as missing', async () => {
    vi.spyOn(api, 'publicSchool').mockRejectedValue(new ApiError(403, 'SCHOOL_SUSPENDED', 'This school is not active'));
    expect((await lookupSchool('closed')).status).toBe('unavailable');
  });

  it('reports rate limiting and server faults as errors to retry', async () => {
    vi.spyOn(api, 'publicSchool').mockRejectedValue(new ApiError(429, 'RATE_LIMITED'));
    expect(await lookupSchool('oakridge')).toEqual({ status: 'error', message: expect.stringMatching(/too many/i) });

    vi.spyOn(api, 'publicSchool').mockRejectedValue(new ApiError(500, 'ERROR'));
    expect((await lookupSchool('oakridge')).status).toBe('error');
  });

  it('reports an unreachable server as a connection problem', async () => {
    vi.spyOn(api, 'publicSchool').mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await lookupSchool('oakridge')).toEqual({ status: 'error', message: expect.stringMatching(/connection/i) });
  });
});

describe('the remembered school', () => {
  it('round-trips a slug', () => {
    expect(recallSchool()).toBeNull();
    rememberSchool('oakridge');
    expect(recallSchool()).toBe('oakridge');
    forgetSchool();
    expect(recallSchool()).toBeNull();
  });

  it('ignores a stored value that is not a school code', () => {
    localStorage.setItem('eduos.lastSchool', '../super-admin');
    expect(recallSchool()).toBeNull();
    localStorage.setItem('eduos.lastSchool', 'super-admin');
    expect(recallSchool()).toBeNull();
  });

  it('forgets a named school only when it is the one remembered', () => {
    rememberSchool('oakridge');
    forgetSchool('nvmp');
    expect(recallSchool()).toBe('oakridge');
    forgetSchool('oakridge');
    expect(recallSchool()).toBeNull();
  });
});
