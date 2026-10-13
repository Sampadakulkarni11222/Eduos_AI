import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RESERVED } from '@/lib/school-lookup';
import { isUnscopedPath } from '@/lib/school-path';

/**
 * A school lives at `/<slug>`, beside the portal's own top-level routes, and a
 * static route always wins. So the list of names a school may not take has to
 * match the routes that actually exist — in three places that cannot import
 * one another: the app folder, the finder (this package) and the backend's
 * school-creation rule. These tests are what keeps them in step: add a
 * top-level route and one of them fails until the name is reserved everywhere.
 */

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Names that could be mistaken for a school: anything shaped like a slug. */
const slugShaped = (names: string[]) => names.filter((n) => SLUG_RE.test(n)).sort();

/** Top-level URL segments the app serves itself. */
function staticSegments(): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(here('../src/app'), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('[')) continue;
    // A route group — (auth) — adds no segment; its children are the routes.
    if (entry.name.startsWith('(')) {
      routes.push(...readdirSync(here(`../src/app/${entry.name}`), { withFileTypes: true })
        .filter((child) => child.isDirectory())
        .map((child) => child.name));
    } else {
      routes.push(entry.name);
    }
  }
  // Folders served from disk at the site root.
  routes.push(...readdirSync(here('../public'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name));
  return slugShaped(routes);
}

describe('names a school may not take', () => {
  it('cover every top-level route the app serves', () => {
    expect([...RESERVED].sort()).toEqual(staticSegments());
  });

  it('are the same list the backend refuses when a school is created', () => {
    const backendFile = here('../../backend/src/modules/schools/school.slug.js');
    // The frontend can be checked out on its own (its Docker build is); the
    // comparison only means something where both halves are present.
    if (!existsSync(backendFile)) return;

    const source = readFileSync(backendFile, 'utf8');
    const list = /RESERVED_SCHOOL_SLUGS = Object\.freeze\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? '';
    const backend = Array.from(list.matchAll(/'([^']+)'/g), (m) => m[1]).sort();

    expect(backend.length).toBeGreaterThan(0);
    expect(backend).toEqual([...RESERVED].sort());
  });

  it('are never given a school prefix when they are routes', () => {
    // `icons` is a folder of files, not a page anything links to.
    for (const name of [...RESERVED].filter((n) => n !== 'icons')) {
      expect(isUnscopedPath(`/${name}`), name).toBe(true);
    }
  });
});
