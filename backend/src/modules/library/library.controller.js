import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { parseCsvRows } from '../../utils/csvImport.js';
import * as service from './library.service.js';

export const getSummary = asyncHandler(async (_req, res) => {
  const summary = await service.getSummary();
  sendSuccess(res, summary, 'Library summary fetched');
});

export const listBooks = asyncHandler(async (req, res) => {
  const books = await service.listBooks(req.query);
  sendSuccess(res, books, 'Books fetched');
});

export const listBookFacets = asyncHandler(async (_req, res) => {
  const facets = await service.listBookFacets();
  sendSuccess(res, facets, 'Book filters fetched');
});

export const getBookById = asyncHandler(async (req, res) => {
  const book = await service.getBookById(req.params.id);
  sendSuccess(res, book, 'Book fetched');
});

export const createBook = asyncHandler(async (req, res) => {
  // The actor is passed separately so the service can stamp who uploaded the
  // resource rather than trusting the body to say.
  const book = await service.createBook(req.body, req.actor);
  const label = book.resourceKind === 'NOTE' ? 'Note'
    : book.resourceKind === 'QUESTION_PAPER' ? 'Question paper'
      : 'Book';
  sendSuccess(res, book, `${label} created`, 201);
});

export const bulkCreateBooks = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkCreateBooks(rows);
  sendSuccess(res, result, `Created ${result.imported} of ${rows.length} books`, 201);
});

export const updateBook = asyncHandler(async (req, res) => {
  const book = await service.updateBook(req.params.id, req.body);
  sendSuccess(res, book, 'Book updated');
});

export const deleteBook = asyncHandler(async (req, res) => {
  await service.deleteBook(req.params.id);
  sendSuccess(res, null, 'Book deleted');
});

export const listIssues = asyncHandler(async (req, res) => {
  const issues = await service.listIssues(req.actor, req.scope, req.query);
  sendSuccess(res, issues, 'Issues fetched');
});

export const issueBook = asyncHandler(async (req, res) => {
  const issue = await service.issueBook(req.body);
  sendSuccess(res, issue, 'Book issued', 201);
});

export const bulkIssueBooks = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkIssueBooks(rows);
  sendSuccess(res, result, `Issued ${result.imported} of ${rows.length} books`, 201);
});

export const returnBook = asyncHandler(async (req, res) => {
  const issue = await service.returnBook(req.params.id);
  sendSuccess(res, issue, 'Book returned');
});

/* ── Book requests ────────────────────────────────────────── */

export const requestBook = asyncHandler(async (req, res) => {
  // The student is resolved from the session inside the service; a studentId
  // in the body is neither read nor honoured.
  const request = await service.requestBook(req.actor, req.body.bookId);
  sendSuccess(res, request, 'Book request submitted for approval', 201);
});

export const listMyBookRequests = asyncHandler(async (req, res) => {
  const requests = await service.listMyBookRequests(req.actor);
  sendSuccess(res, requests, 'Your book requests fetched');
});

export const cancelBookRequest = asyncHandler(async (req, res) => {
  const request = await service.cancelBookRequest(req.actor, req.params.id);
  sendSuccess(res, request, 'Book request cancelled');
});

export const listBookRequestsForReview = asyncHandler(async (req, res) => {
  const page = await service.listBookRequestsForReview(req.actor, req.scope, req.query);
  sendSuccess(res, page, 'Book requests fetched');
});

export const decideBookRequest = asyncHandler(async (req, res) => {
  const request = await service.decideBookRequest(req.actor, req.params.id, {
    status: req.body.status,
    note: req.body.note,
    dueAt: req.body.dueAt,
  });
  sendSuccess(res, request, `Book request ${request.status.toLowerCase()}`);
});
