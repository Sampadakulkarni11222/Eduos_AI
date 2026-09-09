'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, Pill, SkeletonRows, Select, useToast } from '@/components/ui';
import { api, ApiError, fileHref } from '@/lib/api';
import type {
  AcademicYearDto, BookDto, GradeDto, LibraryResourceKind, SubjectDto,
} from '@/lib/types';

/**
 * One shelf of the library catalogue — notes, or question papers.
 *
 * Both are catalogue resources rather than a separate document store, so this
 * reads and writes through the same `/library/books` endpoints the book
 * catalogue uses, with `resourceKind` deciding which shelf is on screen. That
 * is what keeps search, filtering, permissions and pagination identical across
 * all three without a second implementation of any of them.
 *
 * `canManage` is passed by the page rather than inferred here: the librarian's
 * page grants it, the student's does not, and the server enforces the same
 * split through `library.manage` regardless of what this component renders.
 */
export function LibraryResourceShelf({
  kind, title, canManage,
}: {
  kind: Exclude<LibraryResourceKind, 'BOOK'>;
  title: string;
  canManage: boolean;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<BookDto[] | null>(null);
  const [search, setSearch] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [examType, setExamType] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [grades, setGrades] = useState<GradeDto[]>([]);
  const [subjects, setSubjects] = useState<SubjectDto[]>([]);
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [examTypes, setExamTypes] = useState<string[]>([]);

  const load = useCallback(async () => {
    setRows(null);
    try {
      setRows(await api.listBooks({
        resourceKind: kind,
        search: search || undefined,
        gradeId: gradeId || undefined,
        subjectId: subjectId || undefined,
        academicYearId: academicYearId || undefined,
        examType: examType || undefined,
      }));
    } catch {
      setRows([]);
    }
  }, [kind, search, gradeId, subjectId, academicYearId, examType]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    // The filing vocabulary. Failures are swallowed per-list: a missing
    // academic-year read should not empty the class picker beside it.
    api.listGrades().then(setGrades).catch(() => {});
    api.listSubjects().then(setSubjects).catch(() => {});
    api.academicYears().then(setYears).catch(() => {});
    api.bookFacets().then((f) => setExamTypes(f.examTypes ?? [])).catch(() => {});
  }, []);

  const remove = async (row: BookDto) => {
    try {
      await api.deleteBook(row.id);
      toast(`${title} removed.`);
      void load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not remove that.', 'error');
    }
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder={`Search ${title.toLowerCase()}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={`Search ${title}`}
        />
        <Select
          label="Class" hideLabel value={gradeId} onChange={setGradeId}
          options={[{ value: '', label: 'All classes' }, ...grades.map((g) => ({ value: g.id, label: g.name }))]}
        />
        <Select
          label="Subject" hideLabel value={subjectId} onChange={setSubjectId}
          options={[{ value: '', label: 'All subjects' }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]}
        />
        <Select
          label="Academic year" hideLabel value={academicYearId} onChange={setAcademicYearId}
          options={[{ value: '', label: 'All years' }, ...years.map((y) => ({ value: y._id, label: y.name }))]}
        />
        {kind === 'QUESTION_PAPER' && examTypes.length > 0 && (
          <Select
            label="Exam" hideLabel value={examType} onChange={setExamType}
            options={[{ value: '', label: 'All exams' }, ...examTypes.map((e) => ({ value: e, label: e }))]}
          />
        )}
        {canManage && (
          <Button style={{ marginLeft: 'auto' }} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Close' : `+ Add ${title.toLowerCase().replace(/s$/, '')}`}
          </Button>
        )}
      </div>

      {showForm && canManage && (
        <ResourceForm
          kind={kind}
          grades={grades}
          subjects={subjects}
          years={years}
          onDone={() => { setShowForm(false); void load(); }}
        />
      )}

      {rows === null && <Card><SkeletonRows rows={4} /></Card>}
      {rows?.length === 0 && (
        <EmptyState
          title={`No ${title.toLowerCase()} yet`}
          sub={canManage
            ? 'Add one, or clear the filters above.'
            : 'Nothing has been published for these filters.'}
        />
      )}

      {rows && rows.length > 0 && (
        <Card pad={false}>
          <table className="data-table data-table-cards">
            <thead>
              <tr>
                <th>Title</th><th>Class</th><th>Subject</th><th>Year</th>
                {kind === 'QUESTION_PAPER' && <th>Exam</th>}
                <th>Language</th><th>Added by</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-primary" data-label="Title">
                    {r.title}
                    {r.body && <div className="lib-note-body">{r.body}</div>}
                  </td>
                  <td data-label="Class">{r.grade ?? '—'}</td>
                  <td data-label="Subject">{r.subject ?? '—'}</td>
                  <td data-label="Year">{r.academicYear ?? '—'}</td>
                  {kind === 'QUESTION_PAPER' && (
                    <td data-label="Exam">{r.examType ? <Pill tone="blue">{r.examType}</Pill> : '—'}</td>
                  )}
                  <td data-label="Language">{r.language ?? '—'}</td>
                  <td data-label="Added by">
                    {r.uploadedBy ?? '—'}
                    {r.uploadedAt && (
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                        {new Date(r.uploadedAt).toLocaleDateString('en-IN')}
                      </div>
                    )}
                  </td>
                  <td data-label="Actions">
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {r.resourceUrl && (
                        <a className="btn btn-sm btn-ghost" href={fileHref(r.resourceUrl)} target="_blank" rel="noopener noreferrer">
                          Open
                        </a>
                      )}
                      {canManage && (
                        <Button small variant="ghost" onClick={() => void remove(r)}>Remove</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

/**
 * Filing a new resource.
 *
 * A note may be written here or uploaded; a question paper is always a file.
 * The server refuses a resource with neither, so the form asks for one.
 */
function ResourceForm({
  kind, grades, subjects, years, onDone,
}: {
  kind: Exclude<LibraryResourceKind, 'BOOK'>;
  grades: GradeDto[];
  subjects: SubjectDto[];
  years: AcademicYearDto[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [language, setLanguage] = useState('');
  const [examType, setExamType] = useState('');
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (chosen: File | undefined) => {
    if (!chosen) return;
    setUploading(true); setErr(null);
    try {
      const res = await api.uploadFile(chosen);
      setFile({ url: res.fileUrl, name: res.filename ?? chosen.name });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally { setUploading(false); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createBook({
        title,
        author: '—',
        category: kind === 'NOTE' ? 'Notes' : 'Question papers',
        resourceKind: kind,
        resourceType: 'DIGITAL',
        resourceUrl: file?.url,
        body: body.trim() || undefined,
        subjectId: subjectId || undefined,
        gradeId: gradeId || undefined,
        academicYearId: academicYearId || undefined,
        language: language.trim() || undefined,
        examType: examType.trim() || undefined,
      });
      toast('Saved to the library.');
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not save that.');
    } finally { setBusy(false); }
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <form onSubmit={submit}>
        <div className="field-label">Title</div>
        <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} required />

        <div className="pay-form-grid" style={{ marginTop: 10 }}>
          <div>
            <div className="field-label">Class</div>
            <Select label="Class" hideLabel value={gradeId} onChange={setGradeId}
              options={[{ value: '', label: 'Not specific' }, ...grades.map((g) => ({ value: g.id, label: g.name }))]} />
          </div>
          <div>
            <div className="field-label">Subject</div>
            <Select label="Subject" hideLabel value={subjectId} onChange={setSubjectId}
              options={[{ value: '', label: 'Not specific' }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]} />
          </div>
          <div>
            <div className="field-label">Academic year</div>
            <Select label="Academic year" hideLabel value={academicYearId} onChange={setAcademicYearId}
              options={[{ value: '', label: 'Not specific' }, ...years.map((y) => ({ value: y._id, label: y.name }))]} />
          </div>
          <div>
            <div className="field-label">Language</div>
            <input className="field-input" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. English" />
          </div>
        </div>

        {kind === 'QUESTION_PAPER' && (
          <>
            <div className="field-label" style={{ marginTop: 10 }}>Exam</div>
            <input className="field-input" value={examType} onChange={(e) => setExamType(e.target.value)} placeholder="e.g. Midterm" />
          </>
        )}

        {kind === 'NOTE' && (
          <>
            <div className="field-label" style={{ marginTop: 10 }}>Note text</div>
            <textarea className="field-input" rows={4} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="Write the note here, or attach a file below." />
          </>
        )}

        <div className="field-label" style={{ marginTop: 10 }}>
          File{kind === 'QUESTION_PAPER' ? '' : ' (optional if you wrote the note above)'}
        </div>
        <input type="file" className="field-input" disabled={uploading}
          onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} aria-label="Attach a file" />
        {uploading && <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Uploading…</p>}
        {file && <p style={{ fontSize: 12.5, color: 'var(--green)' }}>✓ {file.name} attached</p>}

        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }} role="alert">{err}</p>}

        <Button type="submit" disabled={busy || uploading} style={{ marginTop: 12 }}>
          {busy ? 'Saving…' : 'Save to library'}
        </Button>
      </form>
    </Card>
  );
}
