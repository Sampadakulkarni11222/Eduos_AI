import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { parseCsvRows } from '../../utils/csvImport.js';
import { renderIdCardPdf } from '../../utils/idCardPdf.js';
import * as service from './student.service.js';

export const list = asyncHandler(async (req, res) => {
  const students = await service.list(req.actor, req.scope, req.query);
  sendSuccess(res, students, 'Students fetched');
});

export const getById = asyncHandler(async (req, res) => {
  const student = await service.getById(req.actor, req.scope, req.params.id);
  sendSuccess(res, student, 'Student fetched');
});

export const getOverview = asyncHandler(async (req, res) => {
  const overview = await service.getOverview(req.actor, req.scope, req.params.id);
  sendSuccess(res, overview, 'Student overview fetched');
});

export const getIdCard = asyncHandler(async (req, res) => {
  const data = await service.getIdCardData(req.actor, req.scope, req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="ID-Card-${data.admissionNo}.pdf"`);
  renderIdCardPdf(res, data);
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.create(req.body), 'Student created', 201);
});

export const setPhoto = asyncHandler(async (req, res) => {
  const result = await service.setPhoto(req.actor, req.scope, req.params.id, req.body?.photoUrl);
  sendSuccess(res, result, 'Profile photo updated');
});

export const anonymise = asyncHandler(async (req, res) => {
  const result = await service.anonymiseStudent(req.actor, req.params.id, { reason: req.body?.reason });
  sendSuccess(res, result, result.alreadyAnonymised ? 'Already anonymised' : 'Personal data erased');
});

export const update = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.update(req.params.id, req.body), 'Student updated');
});

export const remove = asyncHandler(async (req, res) => {
  await service.softDelete(req.params.id);
  sendSuccess(res, null, 'Student deactivated');
});

export const addGuardian = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.addGuardian(req.params.id, req.body), 'Guardian linked', 201);
});

export const listGuardians = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listGuardians(req.actor, req.params.id, req.scope), 'Guardians fetched');
});

export const enroll = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.enroll(req.body), 'Student enrolled', 201);
});

export const bulkEnroll = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const { sectionId, academicYearId } = req.body;
  const result = await service.bulkEnroll({ sectionId, academicYearId, rows });
  sendSuccess(res, result, `Enrolled ${result.imported} of ${rows.length} students`, 201);
});

export const listEnrollments = asyncHandler(async (req, res) => {
  const { sectionId, academicYearId, studentId } = req.query;
  const filter = {};
  if (sectionId) filter.sectionId = sectionId;
  if (academicYearId) filter.academicYearId = academicYearId;
  if (studentId) filter.studentId = String(studentId);
  const scoped = await service.scopeEnrollmentFilter(req.actor, req.scope, filter);
  sendSuccess(res, await service.listEnrollments(scoped), 'Enrollments fetched');
});

export const getNextRollNo = asyncHandler(async (req, res) => {
  const { sectionId, academicYearId } = req.query;
  if (!sectionId || !academicYearId) {
    return sendSuccess(res, { nextRollNo: 1 }, 'Next roll number');
  }
  const nextRollNo = await service.nextRollNo(sectionId, academicYearId);
  sendSuccess(res, { nextRollNo }, 'Next roll number');
});

export const updateEnrollmentStatus = asyncHandler(async (req, res) => {
  const enrollment = await service.updateEnrollmentStatus(req.params.id, req.body.status);
  sendSuccess(res, enrollment, 'Enrollment status updated');
});
