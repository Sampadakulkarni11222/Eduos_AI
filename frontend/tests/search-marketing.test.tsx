import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

/**
 * Universal search (menu matching and result links), the QR encoder behind
 * campaign tracking codes, and the newsroom's "Also post to social media".
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/oakridge/admin/newsroom',
  useParams: () => ({ school: 'oakridge' }),
  useSearchParams: () => new URLSearchParams(),
}));
const who = vi.hoisted(() => ({ role: 'ADMIN' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ me: { profile: { id: 'me', role: who.role, displayName: 'Asha' } } }) }));

const { PORTALS } = await import('@/lib/portals');
const { matchPages, resultHref } = await import('@/lib/search-api');
const qr = await import('@/lib/qr');
const { SocialShareSection } = await import('@/components/ops/newsroom-social');
const { BarList } = await import('@/components/ops/growth-marketing-view');
const { attributionFromUrl, formLink } = await import('@/lib/growth-api');

const inApp = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

describe('universal search: pages from the menu', () => {
  it('"fees" jumps to the fees page in each portal\'s own words', () => {
    expect(matchPages(PORTALS.admin.nav, 'fees').map((p) => p.href)).toContain('/admin/payments');
    expect(matchPages(PORTALS.parent.nav, 'fees').map((p) => p.href)).toContain('/parent/payments');
    expect(matchPages(PORTALS.parent.nav, 'fees').every((p) => p.href.startsWith('/parent/'))).toBe(true);
    expect(matchPages(PORTALS.admin.nav, 'f')).toEqual([]);
  });

  it('only searches the menu it is given (a parent never gets admin pages)', () => {
    const hrefs = matchPages(PORTALS.parent.nav, 'user').map((p) => p.href);
    expect(hrefs).not.toContain('/admin/users');
  });

  it('links a result to the first page of its list that the portal has, keeping the query', () => {
    const nav = new Set(['/teacher/classes', '/teacher/library']);
    expect(resultHref('teacher', nav, ['student-classes', 'classes'], { q: 'Rahul Sharma' })).toBe('/teacher/classes?q=Rahul+Sharma');
    expect(resultHref('teacher', nav, ['users'], { q: 'x' })).toBeNull();
  });
});

describe('QR codes for campaign links', () => {
  it('computes Reed–Solomon error correction as the standard\'s worked example', () => {
    // ISO 18004 / common worked example: "HELLO WORLD", version 1-M data codewords.
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(qr.rsRemainder(data, qr.rsDivisor(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('writes the format information of level M for every mask', () => {
    const table = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((m) => qr.formatBits(m).toString(2).padStart(15, '0'))).toEqual(table);
  });

  it('builds a valid symbol: size, finder patterns, readable codewords with zero RS syndromes', () => {
    const text = 'http://localhost:5000/api/v1/public/marketing/r/oakridge/POSTER-S21';
    const code = qr.encodeQr(text);
    expect(code.size).toBe(code.version * 4 + 17);
    expect(code.version).toBe(5);
    // The three finder patterns: dark 7×7 ring with a 3×3 centre.
    for (const [x0, y0] of [[0, 0], [code.size - 7, 0], [0, code.size - 7]]) {
      expect(code.modules[y0][x0]).toBe(true);
      expect(code.modules[y0 + 1][x0 + 1]).toBe(false);
      expect(code.modules[y0 + 3][x0 + 3]).toBe(true);
    }
    // Read the data back out of the matrix (unmasking) and compare with what was encoded.
    const fn = Array.from({ length: code.size }, () => new Array<boolean>(code.size).fill(false));
    const grid = { size: code.size, fn };
    // Function patterns: finders+separators, timing, alignment, format, (no version info below v7).
    for (let y = 0; y < code.size; y++) for (let x = 0; x < code.size; x++) {
      const inFinder = (x < 9 && y < 9) || (x >= code.size - 8 && y < 9) || (x < 9 && y >= code.size - 8);
      if (inFinder || x === 6 || y === 6) fn[y][x] = true;
    }
    for (const ay of qr.alignmentPositions(code.version)) for (const ax of qr.alignmentPositions(code.version)) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === code.size - 7) || (ax === code.size - 7 && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fn[ay + dy][ax + dx] = true;
    }
    const order = qr.placementOrder(grid);
    const bits = order.map(([x, y]) => code.modules[y][x] !== qr.maskHit(code.mask, x, y));
    const read: number[] = [];
    for (let i = 0; i + 8 <= bits.length && read.length < code.codewords.length; i += 8) read.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | (b ? 1 : 0), 0));
    expect(read).toEqual(code.codewords);
    // Version 5-M: two blocks of 43 codewords (19 data + 24 EC); de-interleave and check each block's syndromes.
    const blocks = [0, 1].map((b) => read.filter((_, i) => i % 2 === b));
    for (const blk of blocks) {
      let alpha = 1;
      for (let k = 0; k < 24; k++) {
        let s = 0;
        for (const c of blk) s = qr.gfMul(s, alpha) ^ c;
        expect(s).toBe(0);
        alpha = qr.gfMul(alpha, 2);
      }
    }
  });
});

describe('newsroom: also post to social media', () => {
  const opts = {
    available: true, enabled: true, canPublish: true, rules: 'Only public stories.',
    networks: [{ key: 'FACEBOOK', label: 'Facebook', state: 'SIMULATED' as const, handle: 'oak', note: '' }, { key: 'X', label: 'X', state: 'NOT_CONNECTED' as const, handle: null, note: '' }],
  };

  it('offers each network with its connection state for a public story', () => {
    inApp(<SocialShareSection options={opts} value={[]} onChange={() => undefined} audience="PUBLIC" />);
    expect(screen.getByText('Also post to social media')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Facebook/ })).toBeTruthy();
    expect(screen.getByText('Simulated')).toBeTruthy();
    expect(screen.getByText('Not connected · simulated')).toBeTruthy();
  });

  it('asks for a public audience first', () => {
    inApp(<SocialShareSection options={opts} value={[]} onChange={() => undefined} audience="INSTITUTION" />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/Public \(anyone\)/)).toBeTruthy();
  });

  it('tells an administrator where to switch it on, and shows nothing to anyone else', () => {
    const { container, rerender } = inApp(<SocialShareSection options={{ available: false, enabled: false, canPublish: false, hint: 'Switch it on under Tenant Settings → Features.' }} value={[]} onChange={() => undefined} audience="PUBLIC" />);
    expect(screen.getByRole('link', { name: 'Open Tenant Settings' })).toBeTruthy();
    rerender(<ToastProvider><SocialShareSection options={{ available: false, enabled: true, canPublish: false }} value={[]} onChange={() => undefined} audience="PUBLIC" /></ToastProvider>);
    expect(container.textContent).toBe('');
    rerender(<ToastProvider><SocialShareSection options={null} value={[]} onChange={() => undefined} audience="PUBLIC" /></ToastProvider>);
    expect(container.textContent).toBe('');
  });
});

describe('campaign attribution helpers', () => {
  it('carries the campaign parameters of a link to the form', () => {
    expect(attributionFromUrl('?utm_source=offline&utm_campaign=POSTER-S21&mc=POSTER-S21&x=1')).toEqual({ utm_source: 'offline', utm_campaign: 'POSTER-S21', mc: 'POSTER-S21' });
    expect(formLink('https://school.example', 'oakridge', 'RADIO-927', 'RADIO_SPOT')).toBe('https://school.example/public/admission/oakridge?utm_source=offline&utm_medium=radio_spot&utm_campaign=RADIO-927&mc=RADIO-927');
  });

  it('writes every bar\'s number out, and says when there is nothing', () => {
    const { rerender } = render(<BarList title="Enquiries" rows={[{ label: 'Poster', value: 3, text: '3' }, { label: 'Radio', value: 1, text: '1' }]} />);
    expect(screen.getByText('Poster')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    rerender(<BarList title="Enquiries" rows={[]} />);
    expect(screen.getByText('No data yet.')).toBeTruthy();
  });
});
