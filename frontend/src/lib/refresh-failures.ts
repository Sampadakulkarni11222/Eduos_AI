// Server-only: used by the /api/session/refresh route handler.

/**
 * Failed refreshes allowed per client address per window.
 *
 * The backend sees every refresh arriving from this server's one address, so
 * it cannot tell clients apart; this route can. Only failures count — a user
 * refreshing honestly never touches the budget — and going over it answers
 * 503, which the portal treats as "try later" rather than "signed out", so a
 * user behind a busy school NAT is never signed out by a neighbour.
 */
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = Number(process.env.REFRESH_FAIL_MAX_PER_CLIENT) || 30;
const failures = new Map<string, { count: number; resetAt: number }>();

/** The client address the hosting proxy recorded (the last hop it appended). */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? request.headers.get('x-real-ip') ?? 'unknown';
}

export function overFailureBudget(client: string, now = Date.now()): boolean {
  const entry = failures.get(client);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= FAIL_MAX;
}

export function recordFailure(client: string, now = Date.now()): void {
  const entry = failures.get(client);
  if (!entry || entry.resetAt <= now) failures.set(client, { count: 1, resetAt: now + FAIL_WINDOW_MS });
  else entry.count += 1;
  if (failures.size > 10_000) {
    for (const [key, value] of failures) if (value.resetAt <= now) failures.delete(key);
  }
}

/** Test hook: forget every recorded failure. */
export function __resetRefreshFailures(): void {
  failures.clear();
}
