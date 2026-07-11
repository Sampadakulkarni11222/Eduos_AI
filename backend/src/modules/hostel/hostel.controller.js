import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import * as service from './hostel.service.js';

export const getSummary = asyncHandler(async (_req, res) => {
  const summary = await service.getSummary();
  sendSuccess(res, summary, 'Hostel summary fetched');
});

export const listRooms = asyncHandler(async (req, res) => {
  const rooms = await service.listRooms(req.query);
  sendSuccess(res, rooms, 'Rooms fetched');
});

export const getRoomById = asyncHandler(async (req, res) => {
  const room = await service.getRoomById(req.params.id);
  sendSuccess(res, room, 'Room fetched');
});

export const createRoom = asyncHandler(async (req, res) => {
  const room = await service.createRoom(req.body);
  sendSuccess(res, room, 'Room created', 201);
});

export const updateRoom = asyncHandler(async (req, res) => {
  const room = await service.updateRoom(req.params.id, req.body);
  sendSuccess(res, room, 'Room updated');
});

export const listAllocations = asyncHandler(async (req, res) => {
  const allocations = await service.listAllocations(req.query);
  sendSuccess(res, allocations, 'Allocations fetched');
});

export const allocate = asyncHandler(async (req, res) => {
  const allocation = await service.allocate(req.body);
  sendSuccess(res, allocation, 'Student allocated', 201);
});

export const vacate = asyncHandler(async (req, res) => {
  const allocation = await service.vacate(req.params.id);
  sendSuccess(res, allocation, 'Student vacated');
});

export const listHostelStudents = asyncHandler(async (_req, res) => {
  const students = await service.listHostelStudents();
  sendSuccess(res, students, 'Hostel students fetched');
});

export const getMedicalRecord = asyncHandler(async (req, res) => {
  const record = await service.getMedicalRecord(req.params.studentId);
  sendSuccess(res, record, 'Medical record fetched');
});

export const listInquiries = asyncHandler(async (req, res) => {
  const inquiries = await service.listInquiries(req.query);
  sendSuccess(res, inquiries, 'Inquiries fetched');
});

export const createInquiry = asyncHandler(async (req, res) => {
  const inquiry = await service.createInquiry(req.body);
  sendSuccess(res, inquiry, 'Inquiry created', 201);
});

export const updateInquiry = asyncHandler(async (req, res) => {
  const inquiry = await service.updateInquiry(req.params.id, req.body);
  sendSuccess(res, inquiry, 'Inquiry updated');
});
