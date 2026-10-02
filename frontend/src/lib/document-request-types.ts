/**
 * Shapes returned by /document-requests and /document-types
 * (backend/src/modules/documentRequests). Kept beside types.ts so the module
 * stays self-contained.
 */

export type DocumentRequestStatus =
  | 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'READY' | 'COMPLETED' | 'CANCELLED';

export type DocumentFieldKind = 'text' | 'textarea' | 'date' | 'number' | 'select';
export type DocumentFileType = 'pdf' | 'png' | 'jpeg';

export interface DocumentTypeField {
  key: string;
  label: string;
  kind: DocumentFieldKind;
  required: boolean;
  options: string[];
}

/** What a student sees of a type. */
export interface RequestableDocumentType {
  id: string;
  name: string;
  description: string;
  instructions: string;
  fields: DocumentTypeField[];
}

/** The office's full view of a type. */
export interface DocumentTypeDto extends RequestableDocumentType {
  isActive: boolean;
  requestEnabled: boolean;
  maxFileSizeMb: number;
  allowedFileTypes: DocumentFileType[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DocumentTypeInput {
  name?: string;
  description?: string;
  instructions?: string;
  isActive?: boolean;
  requestEnabled?: boolean;
  fields?: Array<Partial<DocumentTypeField> & { label: string }>;
  maxFileSizeMb?: number;
  allowedFileTypes?: DocumentFileType[];
}

export interface IssuedDocumentFile {
  version: number;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string | null;
  remarks: string | null;
  uploadedBy?: string | null;
}

export interface DocumentRequestDto {
  id: string;
  documentTypeId: string;
  documentTypeName: string;
  status: DocumentRequestStatus;
  purpose: string;
  additionalInformation: string | null;
  requiredBy: string | null;
  requestData: Array<{ key: string; label: string; value: string | null }>;
  requestedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  adminRemarks: string | null;
  cancelledAt: string | null;
  issuedAt: string | null;
  completedAt: string | null;
  /** The current issued file, once READY or COMPLETED. */
  document: IssuedDocumentFile | null;
}

/** The office's view: who asked, and every version issued. */
export interface AdminDocumentRequestDto extends DocumentRequestDto {
  student: { id: string; name: string | null; admissionNo: string | null; className: string | null };
  versions: IssuedDocumentFile[];
}

export interface NewDocumentRequest {
  documentTypeId: string;
  purpose: string;
  additionalInformation?: string;
  requiredBy?: string;
  fields?: Record<string, string>;
}

export interface DocumentRequestFilters {
  q?: string;
  status?: string;
  documentTypeId?: string;
  from?: string;
  to?: string;
  issued?: boolean;
}
