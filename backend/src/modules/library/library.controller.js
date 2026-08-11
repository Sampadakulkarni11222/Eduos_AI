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
  const issues = await service.listIssues(req.query);
  sendSuccess(res, issues, 'Issues fetched');
});

export const listOverdue = asyncHandler(async (_req, res) => {
  const issues = await service.listOverdue();
  sendSuccess(res, issues, 'Overdue issues fetched');
});

export const processReminders = asyncHandler(async (_req, res) => {
  const result = await service.processOverdueReminders();
  sendSuccess(res, result, `Processed overdue reminders: ${result.remindersSent} reminders sent`);
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

export const createReservation = asyncHandler(async (req, res) => {
  const reservation = await service.createBookReservation(req.actor, req.body);
  sendSuccess(res, reservation, 'Book reserved successfully', 201);
});

export const listMyReservations = asyncHandler(async (req, res) => {
  const reservations = await service.listMyBookReservations(req.actor);
  sendSuccess(res, reservations, 'My reservations fetched');
});

export const listReservations = asyncHandler(async (req, res) => {
  const reservations = await service.listBookReservations(req.actor, req.scope, req.query);
  sendSuccess(res, reservations, 'Reservations fetched');
});

export const getReservationById = asyncHandler(async (req, res) => {
  const reservation = await service.getReservationById(req.actor, req.scope, req.params.id);
  sendSuccess(res, reservation, 'Reservation fetched');
});

export const cancelReservation = asyncHandler(async (req, res) => {
  const reservation = await service.cancelBookReservation(req.actor, req.scope, req.params.id, req.body?.reason);
  sendSuccess(res, reservation, 'Reservation cancelled');
});

export const fulfillReservation = asyncHandler(async (req, res) => {
  const reservation = await service.fulfillBookReservation(req.actor, req.params.id);
  sendSuccess(res, reservation, 'Reservation fulfilled');
});
