import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { InstallAppPrompt, isIosSafari } from '@/components/pwa';

/**
 * EduOS AI installed from the website itself: the install offer, and the
 * service worker that supplies the offline page. Both run on the one existing
 * deployment — nothing here is a separate build of the app.
 */

const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';

let standalone = false;

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

beforeEach(() => {
  standalone = false;
  setUserAgent(ANDROID_CHROME);
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(display-mode: standalone)' ? standalone : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

/** What Chrome hands the page when it is willing to install it. */
function offerInstall() {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  });
  act(() => { window.dispatchEvent(event); });
  return { event, prompt };
}

describe('the install offer', () => {
  it('shows nothing until the browser says the site can be installed', () => {
    const { container } = render(<InstallAppPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers an install button when the browser can install, and keeps the browser’s own bar away', () => {
    render(<InstallAppPrompt />);
    const { event } = offerInstall();
    expect(screen.getByRole('button', { name: 'Install the EduOS app' })).toBeInTheDocument();
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens the browser’s install dialog when pressed, once', async () => {
    render(<InstallAppPrompt />);
    const { prompt } = offerInstall();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Install the EduOS app' })); });
    expect(prompt).toHaveBeenCalledTimes(1);
    // A prompt can only be used once, so the button goes with it.
    expect(screen.queryByRole('button', { name: 'Install the EduOS app' })).toBeNull();
  });

  it('disappears once the app has been installed', () => {
    render(<InstallAppPrompt />);
    offerInstall();
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is never shown inside the installed app', () => {
    standalone = true;
    const { container } = render(<InstallAppPrompt />);
    offerInstall();
    expect(container).toBeEmptyDOMElement();
  });

  it('explains Add to Home Screen on iPhone Safari, which has no install prompt', () => {
    setUserAgent(IPHONE_SAFARI);
    render(<InstallAppPrompt />);
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not give Safari’s instructions to other iPhone browsers', () => {
    setUserAgent(IPHONE_CHROME);
    expect(isIosSafari()).toBe(false);
    const { container } = render(<InstallAppPrompt />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the service worker', () => {
  const ORIGIN = 'https://app.example.test';
  const source = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

  type Listener = (event: Record<string, unknown>) => void;
  let listeners: Record<string, Listener>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let cached: Map<string, string>;
  let deleteCache: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listeners = {};
    cached = new Map();
    fetchMock = vi.fn();
    deleteCache = vi.fn(async () => true);
    const cacheStorage = {
      open: vi.fn(async () => ({ addAll: vi.fn(async (urls: string[]) => urls.forEach((u) => cached.set(u, `cached ${u}`))) })),
      keys: vi.fn(async () => ['eduos-offline-v0', 'eduos-offline-v1', 'someone-elses-cache']),
      delete: deleteCache,
      match: vi.fn(async (url: string) => (cached.has(url) ? cached.get(url) : undefined)),
    };
    runInNewContext(source, {
      self: {
        addEventListener: (type: string, fn: Listener) => { listeners[type] = fn; },
        skipWaiting: vi.fn(),
        clients: { claim: vi.fn() },
        location: { origin: ORIGIN },
      },
      caches: cacheStorage,
      fetch: fetchMock,
      Response: { error: () => 'network error' },
      URL,
      Promise,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  /** Dispatches a fetch event; returns what the worker answered with, or undefined if it stayed out. */
  async function request(url: string, { method = 'GET', mode = 'navigate' } = {}) {
    let answer: Promise<unknown> | undefined;
    listeners.fetch({ request: { url, method, mode }, respondWith: (p: Promise<unknown>) => { answer = p; } });
    return answer === undefined ? undefined : await answer;
  }

  async function install() {
    let done: Promise<unknown> | undefined;
    listeners.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
  }

  it('stores only the offline page and its icon when installed', async () => {
    await install();
    expect([...cached.keys()]).toEqual(['/offline.html', '/icons/icon-192.png']);
  });

  it('passes a page load straight through while online', async () => {
    fetchMock.mockResolvedValue('the live page');
    expect(await request(`${ORIGIN}/oakridge/student`)).toBe('the live page');
  });

  it('shows the offline page when a page cannot be loaded', async () => {
    await install();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await request(`${ORIGIN}/oakridge/student`)).toBe('cached /offline.html');
  });

  it('leaves API calls, assets and other sites to the network, uncached', async () => {
    expect(await request(`${ORIGIN}/_next/static/chunk.js`, { mode: 'no-cors' })).toBeUndefined();
    expect(await request(`${ORIGIN}/api/session/refresh`, { method: 'POST', mode: 'cors' })).toBeUndefined();
    expect(await request('https://api.example.test/api/v1/auth/me', { mode: 'cors' })).toBeUndefined();
    expect(await request('https://accounts.google.com/o/oauth2/auth')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears out its own older caches and nothing else', async () => {
    let done: Promise<unknown> | undefined;
    listeners.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(deleteCache.mock.calls.map(([key]) => key)).toEqual(['eduos-offline-v0']);
  });
});
