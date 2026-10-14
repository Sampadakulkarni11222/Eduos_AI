import { describe, it, expect } from 'vitest';
import { stripOperatorKeys, stripOperators } from '../src/middleware/stripOperators.js';

/**
 * Express turns `?enrollmentId[$ne]=x` into an object holding a query
 * operator. Copied into a filter, it matched every invoice in the school for a
 * student. The guard drops operator and prototype keys from the query and the
 * body before any handler runs.
 */
describe('query operators from the client', () => {
  it('drops operator keys, and a field left empty by that, from the query and the body', () => {
    const req = {
      query: { enrollmentId: { $ne: '0' }, status: 'PAID', page: '2' },
      body: { title: 'x', filter: { $where: 'sleep(1)' }, nested: { list: [{ $gt: 1, ok: 1 }] }, permissions: { 'fees.read': 'ALL' } },
    };
    let called = false;
    stripOperators(req, {}, () => { called = true; });
    expect(called).toBe(true);
    expect(req.query).toEqual({ status: 'PAID', page: '2' });
    expect(req.body).toEqual({ title: 'x', nested: { list: [{ ok: 1 }] }, permissions: { 'fees.read': 'ALL' } });
  });

  it('removes prototype keys', () => {
    const body = JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}},"name":"a"}');
    stripOperatorKeys(body);
    expect(Object.keys(body)).toEqual(['name']);
    expect(({}).isAdmin).toBeUndefined();
  });

  it('leaves ordinary values alone', () => {
    const query = { ids: ['a', 'b'], q: 'Rahul Sharma', amount: '100.50' };
    stripOperatorKeys(query);
    expect(query).toEqual({ ids: ['a', 'b'], q: 'Rahul Sharma', amount: '100.50' });
  });
});
