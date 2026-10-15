import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { offlineWrite, syncQueue, listQueued, offlineNotices, __resetOfflineForTests } from '@/lib/offline-queue';
import { OfflineBanner } from '@/components/offline-banner';

/**
 * The offline queue: a write made offline is kept (memory fallback when
 * IndexedDB is unavailable, as in this test browser) with an idempotency key;
 * it replays in order when back online with Idempotency-Key and
 * X-Offline-Queued-At; a server refusal or reported conflict leaves the queue
 * with a visible "school's copy was kept" notice; the banner says
 * "Offline, n changes waiting".
 */
const setOnline = (v: boolean) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  __resetOfflineForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no IndexedDB: the queue must fall back to memory, not throw.
  vi.stubGlobal('indexedDB', undefined);
});
afterEach(() => { vi.unstubAllGlobals(); setOnline(true); });

describe('offline queue', () => {
  it('queues while offline and replays once with the same key when back online', async () => {
    setOnline(false);
    const r = await offlineWrite('ATTENDANCE', '/attendance/mark', { sectionId: 's', date: '2026-10-15', entries: [] }, 'Attendance 6 A');
    expect(r.queued).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listQueued()).toHaveLength(1);

    setOnline(true);
    fetchMock.mockResolvedValueOnce(ok({ roster: [] }));
    const out = await syncQueue();
    expect(out).toEqual({ sent: 1, left: 0 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/attendance\/mark$/);
    expect(init.headers['Idempotency-Key']).toBe(r.key);
    expect(init.headers['X-Offline-Queued-At']).toBeTruthy();
    expect(offlineNotices()[0].tone).toBe('ok');
  });

  it('queues a write whose request never reached the server', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const r = await offlineWrite('CHECKPOINT_SCAN', '/checkpoints/scan', { code: 'OAK-1', point: 'BUS' }, 'Scan OAK-1');
    expect(r.queued).toBe(true);
    expect(await listQueued()).toHaveLength(1);
  });

  it('drops a refused replay and says the school copy was kept', async () => {
    setOnline(false);
    await offlineWrite('CLASS_CHECK_IN', '/class-check-ins', { periodNo: 1 }, 'Class check-in, period 1');
    setOnline(true);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: 'You have already checked in for this period.', error: { code: 'ALREADY_CHECKED_IN' } }), { status: 409 }));
    await syncQueue();
    expect(await listQueued()).toHaveLength(0);
    expect(offlineNotices()[0]).toMatchObject({ tone: 'conflict', label: 'Class check-in, period 1' });
    expect(offlineNotices()[0].text).toMatch(/already checked in.*school's copy was kept/);
  });

  it('reports attendance entries the server kept', async () => {
    // The server puts the conflicts inside `data` as well, which is what the client unwraps.
    fetchMock.mockResolvedValueOnce(ok({ roster: [], conflicts: [{ yours: 'ABSENT', kept: 'LATE' }] }));
    const r = await offlineWrite('ATTENDANCE', '/attendance/mark', { entries: [] }, 'Attendance 6 A');
    expect(r.queued).toBe(false);
    expect(offlineNotices()[0].text).toMatch(/absent → kept late/);
  });

  it('shows "Offline, n changes waiting"', async () => {
    setOnline(false);
    await offlineWrite('SANITATION_CHECK', '/sustainability/sanitation/x/checks', {}, 'Sanitation check');
    await offlineWrite('PTM_CHECK_IN', '/ptm/bookings/x/check-in', {}, 'PTM check-in');
    await act(async () => { render(<OfflineBanner />); });
    expect(await screen.findByText(/Offline, 2 changes waiting/)).toBeInTheDocument();
  });
});
