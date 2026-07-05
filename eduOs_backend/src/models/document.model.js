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
  },
  { timestamps: true }
);

export const Document = mongoose.model('Document', documentSchema);
