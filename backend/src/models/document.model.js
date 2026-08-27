import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, required: true, default: 'CUSTOM' },
    fileUrl: { type: String, required: true },
    mimeType: { type: String, default: null },
    visibleToRoles: [{ type: String }],
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
    academicYearId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', default: null },
    authorProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    // Class scoping for CUSTOM course material — null on report cards/ID cards/
    // TCs/letters, which aren't tied to a single section.
    sectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', default: null },
    subjectOfferingId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubjectOffering', default: null },
  },
  { timestamps: true }
);

// Indexes follow buildVisibilityFilter() in modules/documents/document.service.js,
// which is the only way documents are ever queried. Every list is sorted by
// createdAt descending, so it is the trailing key on each compound index —
// that lets Mongo satisfy the sort from the index instead of collecting the
// whole match and sorting it in memory.
documentSchema.index({ visibleToRoles: 1, createdAt: -1 }); // the common role-scoped list
documentSchema.index({ studentId: 1, createdAt: -1 }); // a single student's documents
documentSchema.index({ authorProfileId: 1, type: 1 }); // teacher's own course-material count
documentSchema.index({ sectionId: 1, type: 1, createdAt: -1 }); // section-scoped course material

export const Document = mongoose.model('Document', documentSchema);
