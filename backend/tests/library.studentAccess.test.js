import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Book, BookIssue } from '../src/models/library.model.js';
import { SYSTEM_ROLES } from '../src/constants/permissions.js';
import { buildPermissionMap } from '../src/utils/buildPermissionMap.js';
import { runWithTenant } from '../src/tenancy/tenantContext.js';
import * as library from '../src/modules/library/library.service.js';

/**
 * ISSUE-07 — the Student Library page called /library/books and
 * /library/issues, but STUDENT held no `library.read` grant at all, so both
 * calls 403'd and the page silently rendered empty (its .catch(() => {})).
 * Granting the permission alone would also let a student pass an arbitrary
 * ?studentId= and read another student's borrow history, so listIssues() now
 * takes (actor, scope, ...) and a non-ALL scope always resolves to the
 * caller's own profileId, the same convention used across the other modules.
 */

const OAK = 'oakridge';
const inOak = (fn) => runWithTenant(OAK, fn);

const permsOf = (roleKey) => buildPermissionMap({ permissions: SYSTEM_ROLES.find((r) => r.key === roleKey).grants });
const scopeOf = (roleKey, key) => permsOf(roleKey)[key];
const actorFor = (roleKey, profileId) => ({ roleKey, profileId: profileId.toString(), permissions: permsOf(roleKey) });

const me = new mongoose.Types.ObjectId();
const someoneElse = new mongoose.Types.ObjectId();

beforeEach(async () => {
  await inOak(async () => {
    const book = await Book.create({ title: 'Wonderland', author: 'Carroll', totalCopies: 2, availableCopies: 1 });
    await BookIssue.create({ bookId: book._id, borrowerProfileId: me, borrowerName: 'Me', dueDate: new Date(Date.now() + 86400000) });
    await BookIssue.create({ bookId: book._id, borrowerProfileId: someoneElse, borrowerName: 'Someone Else', dueDate: new Date(Date.now() + 86400000) });
  });
});

it('STUDENT now holds library.read (it held nothing before this fix)', () => {
  expect(scopeOf('STUDENT', 'library.read')).toBe('OWN');
});

it('a student sees only their own issued books', async () => {
  const issues = await inOak(() => library.listIssues(actorFor('STUDENT', me), 'OWN', {}));
  expect(issues).toHaveLength(1);
  expect(issues[0].studentId).toBe(me.toString());
});

it('a student cannot read another student\'s issues by passing a different studentId', async () => {
  const issues = await inOak(() => library.listIssues(actorFor('STUDENT', me), 'OWN', { studentId: someoneElse.toString() }));
  expect(issues).toHaveLength(1);
  expect(issues[0].studentId).toBe(me.toString()); // own id wins, not the one supplied
});

it('an ALL-scope caller (librarian) can still filter by any studentId', async () => {
  const issues = await inOak(() => library.listIssues(actorFor('LIBRARIAN', new mongoose.Types.ObjectId()), 'ALL', { studentId: someoneElse.toString() }));
  expect(issues).toHaveLength(1);
  expect(issues[0].studentId).toBe(someoneElse.toString());
});

it('the catalog itself is visible to a student', async () => {
  const page = await inOak(() => library.listBooks({}));
  expect(page).toHaveLength(1);
  expect(page[0].title).toBe('Wonderland');
});
