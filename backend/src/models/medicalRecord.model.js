import { Schema, model } from 'mongoose';

// Sensitive fields are envelope-encrypted at the application layer (see src/utils/crypto.js)
// and stored as opaque base64 strings; reads/writes go through the medical module only.
const medicalRecordSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, unique: true },
    bloodGroup: { type: String },
    heightCm: { type: Number },
    weightKg: { type: Number },
    emergencyContactEnc: { type: String }, // encrypted {name, phone, relation}
    allergiesEnc: { type: String }, // encrypted string[]
    medicationsEnc: { type: String },
    historyEnc: { type: String },
    attachmentsEnc: { type: String }, // encrypted array of { name, fileUrl }
  },
  { timestamps: true }
);

export const MedicalRecord = model('MedicalRecord', medicalRecordSchema);
