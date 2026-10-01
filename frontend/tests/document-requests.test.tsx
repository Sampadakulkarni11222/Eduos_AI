import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { api } from '@/lib/api';
import { PORTALS } from '@/lib/portals';
import { getRequiredPermission } from '@/lib/permissions';
import { DocumentRequestsPanel } from '@/components/student/document-requests-panel';
import type { AdminDocumentRequestDto, DocumentRequestDto, DocumentTypeDto, RequestableDocumentType } from '@/lib/document-request-types';

/**
 * Document request screens. The API is spied on, so these check what each
 * screen sends and shows; authorization, validation and the file rules are
 * covered by the backend suite.
 */

vi.mock('@/components/shell', () => ({
  PortalShell: ({ topbar, children }: { topbar: { title: string; actions?: React.ReactNode }; children: React.ReactNode }) => (
    <div><h1>{topbar.title}</h1>{topbar.actions}{children}</div>
  ),
}));

const { default: AdminDocumentRequestsPage } = await import('@/app/[school]/admin/document-requests/page');
const { default: AdminDocumentTypesPage } = await import('@/app/[school]/admin/document-types/page');

const internship: RequestableDocumentType = {
  id: 'type-int', name: 'Internship Certificate', description: 'For internships', instructions: 'Attach offer letter details.',
  fields: [{ key: 'company_name', label: 'Company name', kind: 'text', required: true, options: [] }],
};
const bonafide: RequestableDocumentType = { id: 'type-bon', name: 'Bonafide Certificate', description: '', instructions: '', fields: [] };

const req = (over: Partial<DocumentRequestDto> = {}): DocumentRequestDto => ({
  id: 'req-1', documentTypeId: 'type-bon', documentTypeName: 'Bonafide Certificate', status: 'PENDING', purpose: 'Internship',
  additionalInformation: null, requiredBy: null, requestData: [], requestedAt: '2026-10-01T00:00:00.000Z', reviewedAt: null,
  approvedAt: null, rejectedAt: null, rejectionReason: null, adminRemarks: null, cancelledAt: null, issuedAt: null,
  completedAt: null, document: null, ...over,
});
const adminReq = (over: Partial<AdminDocumentRequestDto> = {}): AdminDocumentRequestDto => ({
  ...req(), student: { id: 'stu-1', name: 'Rahul Patil', admissionNo: 'STU00123', className: 'SY BTech' }, versions: [], ...over,
});

beforeEach(() => vi.restoreAllMocks());

describe('navigation and page permissions', () => {
  const hrefs = (slug: string) => PORTALS[slug].nav.flatMap((g) => g.items).map((i) => i.href);

  it('puts Document Requests and Document Types in the admin portal only', () => {
    expect(hrefs('admin')).toEqual(expect.arrayContaining(['/admin/document-requests', '/admin/document-types']));
    for (const slug of Object.keys(PORTALS).filter((x) => x !== 'admin')) {
      expect(hrefs(slug).some((h) => h.includes('document-'))).toBe(false);
    }
  });

  it('gates the pages on the same keys the API enforces', () => {
    expect(getRequiredPermission('/admin/document-requests')).toBe('students.manage');
    expect(getRequiredPermission('/admin/document-types')).toBe('settings.manage');
  });
});

describe('student profile: Document Requests panel', () => {
  it('asks the selected type\'s own questions and submits the answers', async () => {
    vi.spyOn(api, 'myDocumentRequests').mockResolvedValue([]);
    vi.spyOn(api, 'requestableDocumentTypes').mockResolvedValue([bonafide, internship]);
    const create = vi.spyOn(api, 'createDocumentRequest').mockResolvedValue(req());

    render(<ToastProvider><DocumentRequestsPanel /></ToastProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '+ Request a document' }));

    // Bonafide asks nothing extra; switching to Internship adds its question.
    expect(screen.queryByLabelText(/Company name/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'type-int' } });
    expect(screen.getByText('Attach offer letter details.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason / purpose'), { target: { value: 'Summer internship' } });

    // Required question left blank: nothing is sent. (The browser's own
    // required-field check stops a click; submitting directly shows the
    // panel's check underneath it.)
    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(create).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole('button', { name: 'Submit Request' }).closest('form')!);
    expect(await screen.findByText('Company name is required.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Company name/), { target: { value: 'Acme Ltd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      documentTypeId: 'type-int', purpose: 'Summer internship', additionalInformation: undefined, requiredBy: undefined,
      fields: { company_name: 'Acme Ltd' },
    }));
  });

  it('lists requests with status, shows the rejection reason, and downloads a ready document', async () => {
    vi.spyOn(api, 'requestableDocumentTypes').mockResolvedValue([bonafide]);
    vi.spyOn(api, 'myDocumentRequests').mockResolvedValue([
      req({
        id: 'ready', status: 'READY', issuedAt: '2026-10-03T00:00:00.000Z',
        document: { version: 1, fileName: 'bonafide.pdf', mimeType: 'application/pdf', size: 2048, uploadedAt: '2026-10-03T00:00:00.000Z', remarks: null },
      }),
      req({ id: 'rej', documentTypeName: 'Fee Certificate', status: 'REJECTED', rejectionReason: 'Fee dues pending' }),
    ]);
    const open = vi.spyOn(api, 'openMyIssuedDocument').mockResolvedValue(undefined);

    render(<ToastProvider><DocumentRequestsPanel /></ToastProvider>);
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();

    // Only the ready request offers a download.
    const downloads = screen.getAllByRole('button', { name: 'Download' });
    expect(downloads).toHaveLength(1);
    fireEvent.click(downloads[0]);
    await waitFor(() => expect(open).toHaveBeenCalledWith('ready'));

    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[1]);
    expect(await screen.findByText('Fee dues pending')).toBeInTheDocument();
  });
});

describe('student profile page', () => {
  it('shows the Document Requests panel alongside the existing panels', async () => {
    const { default: StudentProfile } = await import('@/app/[school]/student/profile/page');
    vi.spyOn(api, 'students').mockResolvedValue({ items: [{ id: 'stu-1' }] } as never);
    vi.spyOn(api, 'studentOverview').mockResolvedValue({
      id: 'stu-1', name: 'Priya Verma', admissionNo: 'OAK-2', dob: null, gender: null, address: null,
      photoUrl: null, attendance: null, enrollment: null, guardians: [],
    } as never);
    vi.spyOn(api, 'myProfileEditRequests').mockResolvedValue([]);
    vi.spyOn(api, 'profileEditFields').mockResolvedValue({ fields: [] } as never);
    vi.spyOn(api, 'coCurricular').mockResolvedValue([]);
    vi.spyOn(api, 'myDocumentRequests').mockResolvedValue([]);
    vi.spyOn(api, 'requestableDocumentTypes').mockResolvedValue([bonafide]);

    render(<ToastProvider><StudentProfile /></ToastProvider>);
    expect(await screen.findByText('Document Requests')).toBeInTheDocument();
    expect(await screen.findByText('Co-curricular record')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Request a document' })).toBeEnabled();
  });
});

describe('student download', () => {
  it('shows the request as completed after the first download', async () => {
    vi.spyOn(api, 'requestableDocumentTypes').mockResolvedValue([bonafide]);
    const list = vi.spyOn(api, 'myDocumentRequests').mockResolvedValue([req({
      status: 'READY',
      document: { version: 1, fileName: 'bonafide.pdf', mimeType: 'application/pdf', size: 10, uploadedAt: null, remarks: null },
    })]);
    vi.spyOn(api, 'openMyIssuedDocument').mockResolvedValue(undefined);

    render(<ToastProvider><DocumentRequestsPanel /></ToastProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    // No refetch racing the server's after-send update.
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe('admin: Document Requests', () => {
  it('lists the school\'s requests and requires a reason to reject', async () => {
    vi.spyOn(api, 'documentTypes').mockResolvedValue([]);
    const list = vi.spyOn(api, 'documentRequests').mockResolvedValue([adminReq()]);
    const reject = vi.spyOn(api, 'rejectDocumentRequest').mockResolvedValue(adminReq({ status: 'REJECTED', rejectionReason: 'Fee dues pending' }));

    render(<ToastProvider><AdminDocumentRequestsPage /></ToastProvider>);
    expect(await screen.findByText('Rahul Patil')).toBeInTheDocument();
    expect(screen.getByText('STU00123')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ issued: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject Request' }));
    expect(reject).not.toHaveBeenCalled();
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Reject Request' }).closest('form')!);
    expect(await within(dialog).findByText('Enter a rejection reason the student can act on.')).toBeInTheDocument();
    expect(reject).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Rejection reason'), { target: { value: 'Fee dues pending' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject Request' }));
    await waitFor(() => expect(reject).toHaveBeenCalledWith('req-1', 'Fee dues pending'));
  });

  it('uploads through the existing upload service, then issues the document', async () => {
    vi.spyOn(api, 'documentTypes').mockResolvedValue([]);
    vi.spyOn(api, 'documentRequests').mockResolvedValue([adminReq({ status: 'APPROVED' })]);
    const upload = vi.spyOn(api, 'uploadFile').mockResolvedValue({ fileUrl: '/uploads/abc-bonafide.pdf', filename: 'bonafide.pdf', size: 10, mimeType: 'application/pdf' } as never);
    const issue = vi.spyOn(api, 'issueDocument').mockResolvedValue(adminReq({ status: 'READY' }));

    render(<ToastProvider><AdminDocumentRequestsPage /></ToastProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload document' }));
    const file = new File(['%PDF-1.4'], 'bonafide.pdf', { type: 'application/pdf' });
    fireEvent.change(within(dialog).getByLabelText('File'), { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload & Issue Document' }));
    await waitFor(() => expect(issue).toHaveBeenCalledWith('req-1', { fileUrl: '/uploads/abc-bonafide.pdf', remarks: undefined }));
    expect(upload).toHaveBeenCalledWith(file);
  });

  it('switches to Issued Documents', async () => {
    vi.spyOn(api, 'documentTypes').mockResolvedValue([]);
    const list = vi.spyOn(api, 'documentRequests').mockResolvedValue([]);
    render(<ToastProvider><AdminDocumentRequestsPage /></ToastProvider>);
    fireEvent.click(await screen.findByRole('tab', { name: 'Issued Documents' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ issued: true })));
  });
});

describe('admin: Document Types', () => {
  const type = (over: Partial<DocumentTypeDto> = {}): DocumentTypeDto => ({
    ...bonafide, isActive: true, requestEnabled: true, maxFileSizeMb: 5, allowedFileTypes: ['pdf'], createdAt: null, updatedAt: null, ...over,
  });

  it('adds the suggested types and deactivates one like any other', async () => {
    vi.spyOn(api, 'documentTypes').mockResolvedValueOnce([]).mockResolvedValue([type()]);
    const suggested = vi.spyOn(api, 'addSuggestedDocumentTypes').mockResolvedValue({ created: [type()], skipped: [] });
    const update = vi.spyOn(api, 'updateDocumentType').mockResolvedValue(type({ isActive: false }));

    render(<ToastProvider><AdminDocumentTypesPage /></ToastProvider>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add Suggested Types' }))[0]);
    await waitFor(() => expect(suggested).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('type-bon', { isActive: false }));
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
  });
});
