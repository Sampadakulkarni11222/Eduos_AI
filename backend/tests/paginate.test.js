import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { Book } from '../src/models/library.model.js';
import { logger } from '../src/utils/logger.js';
import { paginate, mapPage, MAX_PAGE_SIZE, UNPAGINATED_CAP } from '../src/utils/paginate.js';
import { listBooks } from '../src/modules/library/library.service.js';

/**
 * Covers ISS-010: unbounded list queries. The contract that matters most is
 * that adding pagination did NOT change the response for existing callers —
 * every frontend consumer still types these endpoints as a bare array.
 */

const makeBooks = (n, prefix = 'B') =>
  Book.insertMany(
    Array.from({ length: n }, (_, i) => ({
      title: `${prefix}${String(i).padStart(4, '0')}`,
      author: 'Author',
      isbn: `${prefix}-${i}`,
      totalCopies: 1,
      availableCopies: 1,
    }))
  );

const query = () => Book.find({}).sort({ title: 1 });

describe('paginate — backward compatibility', () => {
  beforeEach(async () => { await makeBooks(25); });

  it('returns a bare array when the caller does not paginate', async () => {
    const res = await paginate(query(), Book, {});
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(25);
  });

  it('returns a bare array for pageSize 0 or a non-numeric pageSize', async () => {
    for (const pageSize of [0, '', 'abc', undefined, null]) {
      expect(Array.isArray(await paginate(query(), Book, {}, { pageSize }))).toBe(true);
    }
  });
});

describe('paginate — paged responses', () => {
  beforeEach(async () => { await makeBooks(25); });

  it('returns a Paged envelope when pageSize is given', async () => {
    const res = await paginate(query(), Book, {}, { page: 1, pageSize: 10 });
    expect(res.items).toHaveLength(10);
    expect(res).toMatchObject({ total: 25, page: 1, pageSize: 10, totalPages: 3 });
  });

  it('returns the correct slice for a later page', async () => {
    const p1 = await paginate(query(), Book, {}, { page: 1, pageSize: 10 });
    const p3 = await paginate(query(), Book, {}, { page: 3, pageSize: 10 });
    expect(p3.items).toHaveLength(5);
    // Pages must not overlap — a total sort order is what guarantees this.
    expect(p3.items[0].title).not.toBe(p1.items[0].title);
  });

  it('clamps an out-of-range page to the last real page', async () => {
    const res = await paginate(query(), Book, {}, { page: 99, pageSize: 10 });
    expect(res.page).toBe(3);
    expect(res.items).toHaveLength(5);
  });

  it('clamps page 0 and negative pages up to 1', async () => {
    for (const page of [0, -5]) {
      expect((await paginate(query(), Book, {}, { page, pageSize: 10 })).page).toBe(1);
    }
  });

  it('caps pageSize so a caller cannot request the whole collection', async () => {
    const res = await paginate(query(), Book, {}, { page: 1, pageSize: 100_000 });
    expect(res.pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('reports at least one page when nothing matches', async () => {
    await Book.deleteMany({});
    const res = await paginate(query(), Book, {}, { page: 1, pageSize: 10 });
    expect(res).toMatchObject({ total: 0, totalPages: 1, page: 1 });
    expect(res.items).toEqual([]);
  });
});

describe('paginate — the unpaginated cap', () => {
  afterEach(() => vi.restoreAllMocks());

  it('caps an unpaginated query and warns rather than truncating silently', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await makeBooks(UNPAGINATED_CAP + 10);

    const res = await paginate(query(), Book, {}, { label: 'test.list' });

    expect(res).toHaveLength(UNPAGINATED_CAP);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('test.list');
  }, 60_000);

  it('does not warn when the result fits under the cap', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await makeBooks(5);
    await paginate(query(), Book, {});
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('mapPage', () => {
  it('maps a bare array', () => {
    expect(mapPage([1, 2], (n) => n * 2)).toEqual([2, 4]);
  });

  it('maps inside an envelope and preserves the paging fields', () => {
    const res = mapPage({ items: [1, 2], total: 2, page: 1, pageSize: 10, totalPages: 1 }, (n) => n * 2);
    expect(res).toEqual({ items: [2, 4], total: 2, page: 1, pageSize: 10, totalPages: 1 });
  });
});

describe('library.listBooks — end to end through a real service', () => {
  beforeEach(async () => { await makeBooks(12); });

  it('still returns an array for existing callers', async () => {
    const res = await listBooks({});
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(12);
    expect(res[0]).toHaveProperty('title');
  });

  it('returns mapped DTOs inside an envelope when paginated', async () => {
    const res = await listBooks({ page: 2, pageSize: 5 });
    expect(res.items).toHaveLength(5);
    expect(res.total).toBe(12);
    // The DTO mapping still applies inside the envelope.
    expect(res.items[0]).toHaveProperty('availableCopies');
    expect(res.items[0]).not.toHaveProperty('_id');
  });

  it('applies pagination on top of a search filter, not instead of it', async () => {
    await makeBooks(3, 'ZZ');
    const res = await listBooks({ search: 'ZZ', page: 1, pageSize: 2 });
    expect(res.total).toBe(3);
    expect(res.items).toHaveLength(2);
  });
});
