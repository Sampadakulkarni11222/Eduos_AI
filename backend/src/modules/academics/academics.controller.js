import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { parseCsvRows } from '../../utils/csvImport.js';
import * as service from './academics.service.js';

export const listYears = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.listYears(), 'Academic years fetched');
});
export const createYear = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createYear(req.body), 'Academic year created', 201);
});

export const listTerms = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.listTerms(req.query.academicYearId), 'Terms fetched');
});
export const createTerm = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createTerm(req.body), 'Term created', 201);
});

export const listGrades = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.listGrades(), 'Grades fetched');
});
export const createGrade = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createGrade(req.body), 'Grade created', 201);
});
export const bulkCreateGrades = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkCreateGrades(rows);
  sendSuccess(res, result, `Created ${result.imported} of ${rows.length} grades`, 201);
});

export const listSections = asyncHandler(async (req, res) => {
  const sections = await service.listSections(req.query.gradeId);
  const dtos = sections.map(s => ({
    id: s._id,
    gradeName: s.gradeId?.name || '',
    name: s.name,
    classTeacher: s.classTeacherId?.displayName || null,
    classTeacherId: s.classTeacherId?._id?.toString() ?? null,
  }));
  sendSuccess(res, dtos, 'Sections fetched');
});
export const createSection = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createSection(req.body), 'Section created', 201);
});
export const bulkCreateSections = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkCreateSections(rows);
  sendSuccess(res, result, `Created ${result.imported} of ${rows.length} sections`, 201);
});

export const listSubjects = asyncHandler(async (_req, res) => {
  sendSuccess(res, await service.listSubjects(), 'Subjects fetched');
});
export const createSubject = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createSubject(req.body), 'Subject created', 201);
});
export const bulkCreateSubjects = asyncHandler(async (req, res) => {
  const rows = parseCsvRows(req);
  const result = await service.bulkCreateSubjects(rows);
  sendSuccess(res, result, `Created ${result.imported} of ${rows.length} subjects`, 201);
});

export const listOfferings = asyncHandler(async (req, res) => {
  const { sectionId, subjectId, termId } = req.query;
  const filter = {};
  if (sectionId) filter.sectionId = sectionId;
  if (subjectId) filter.subjectId = subjectId;
  if (termId) filter.termId = termId;
  
  const offerings = await service.listOfferings(filter);
  const dtos = offerings.map(o => ({
    id: o._id,
    sectionId: o.sectionId?._id || '',
    sectionName: o.sectionId?.name || '',
    subject: o.subjectId?.name || '',          // matches OfferingDto.subject
    subjectId: o.subjectId?._id || '',
    teacherName: o.teacherId?.displayName || null,
  }));
  
  sendSuccess(res, dtos, 'Subject offerings fetched');
});
export const createOffering = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.createOffering(req.body), 'Subject offering created', 201);
});

// Helper to map section to SectionDto shape expected by frontend
function toSectionDto(s) {
  return {
    id: s._id,
    gradeName: s.gradeId?.name || '',          // matches SectionDto.gradeName
    name: s.name,
    classTeacher: s.classTeacherId?.displayName || null,
    classTeacherId: s.classTeacherId?._id?.toString() ?? null,
  };
}

// Helper to map offering to OfferingDto
function toOfferingDto(o) {
  return {
    id: o._id,
    sectionId: o.sectionId?._id || o.sectionId || '',
    sectionName: o.sectionId?.name || '',
    gradeName: o.sectionId?.gradeId?.name || '',
    subject: o.subjectId?.name || '',          // matches OfferingDto.subject
    subjectId: o.subjectId?._id || o.subjectId || '',
    teacherName: o.teacherId?.displayName || null,
  };
}

export const mySections = asyncHandler(async (req, res) => {
  const sections = await service.getMySections(req.actor);
  sendSuccess(res, sections.map(toSectionDto), 'My sections fetched');
});

export const myOfferings = asyncHandler(async (req, res) => {
  const offerings = await service.getMyOfferings(req.actor);
  sendSuccess(res, offerings.map(toOfferingDto), 'My offerings fetched');
});
