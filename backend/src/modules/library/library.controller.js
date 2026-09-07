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
  const book = await service.createBook(req.body);
  sendSuccess(res, book, 'Book created', 201);
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
