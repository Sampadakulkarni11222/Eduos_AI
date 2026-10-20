import { Schema, model } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScope.js';

/**
 * The register of certificates the school office generated from the records
 * (transfer, leaving, bonafide, character, fee): serial number, verification
 * code, who issued it, the no-dues check at that moment and, when issued with
 * dues open, the reason given. See modules/leadership/certificates.service.js.
 */
const issuedCertificateSchema = new Schema({
  requestId: { type: Schema.Types.ObjectId, ref: 'DocumentRequest', required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  studentName: { type: String, default: null },
  admissionNo: { type: String, default: null },
  kind: { type: String, required: true },
  title: { type: String, required: true },
  serialNo: { type: String, required: true },
  verificationCode: { type: String, required: true },
  issuedByProfileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true },
  issuedByName: { type: String, default: null },
  clearance: { type: Schema.Types.Mixed, default: null },
  overrideReason: { type: String, default: null },
  version: { type: Number, default: 1 },
  status: { type: String, enum: ['ISSUED', 'CANCELLED'], default: 'ISSUED' },
}, { timestamps: true });
issuedCertificateSchema.index({ tenantId: 1, serialNo: 1 }, { unique: true });
issuedCertificateSchema.index({ tenantId: 1, verificationCode: 1 }, { unique: true });
issuedCertificateSchema.plugin(tenantScoped);
export const IssuedCertificate = model('IssuedCertificate', issuedCertificateSchema);
