'use client';
import { useCallback, useEffect, useState } from 'react';
import { PortalShell } from '@/components/shell';
import { Avatar, Card, EmptyState, Pill, SkeletonRows } from '@/components/ui';
import { IdCardPanel } from '@/components/id-card-action';
import { ProfileEditRequestPanel } from '@/components/student/profile-edit-request';
import { CoCurricularPanel } from '@/components/student/cocurricular-panel';
import { api, ApiError, fileHref } from '@/lib/api';
import type { StudentOverviewDto } from '@/lib/types';

const RELATION_LABEL: Record<string, string> = {
  FATHER: 'Father', MOTHER: 'Mother', GUARDIAN: 'Guardian',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Student profile: identity, enrolment, guardians and emergency contacts,
 * the co-curricular record, and the live-generated ID card.
 *
 * The record itself stays read-only here. Corrections go through "Request
 * Edit", which files a request for the class teacher rather than writing to
 * the student's own record — the school still owns the source data, the
 * student now has a way to say what is wrong with it.
 */
export default function StudentProfile() {
  const [overview, setOverview] = useState<StudentOverviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);

  /**
   * Uploads the file, then points the student record at the stored path.
   * Two steps because /uploads is generic storage — it has no idea the bytes
   * are meant to become someone's ID-card photo.
   */
  const uploadPhoto = async (file: File) => {
    setPhotoBusy(true);
    setPhotoErr(null);
    try {
      const { fileUrl } = await api.uploadFile(file);
      const saved = await api.setStudentPhoto(overview!.id, fileUrl);
      setOverview((prev) => (prev ? { ...prev, photoUrl: saved.photoUrl } : prev));
    } catch (e) {
      setPhotoErr(e instanceof ApiError ? e.message : 'Could not update your photo. Please try again.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const loadOverview = useCallback(async () => {
    const r = await api.students();
    const me = r.items[0];
    return me ? api.studentOverview(me.id) : null;
  }, []);

  useEffect(() => {
    let stale = false;
    loadOverview()
      .then((o) => !stale && setOverview(o ?? null))
      .catch(() => !stale && setOverview(null))
      .finally(() => !stale && setLoading(false));
    return () => { stale = true; };
  }, [loadOverview]);

  /**
   * Re-read the record after a request is raised or a decision lands.
   *
   * An approval is applied server-side, so the profile on screen is stale from
   * the moment it happens; this is what makes an approved correction actually
   * appear without a page reload.
   */
  const refresh = useCallback(() => {
    loadOverview().then((o) => setOverview(o ?? null)).catch(() => {});
  }, [loadOverview]);

  const rows: Array<[string, string]> = overview
    ? [
        ['Admission number', overview.admissionNo || '—'],
        ['Class', overview.enrollment?.class ?? '—'],
        ['Roll number', overview.enrollment?.rollNo != null ? String(overview.enrollment.rollNo) : '—'],
        ['Date of birth', formatDate(overview.dob)],
        ['Gender', overview.gender ?? '—'],
        ['Address', overview.address ?? '—'],
      ]
    : [];

  return (
    <PortalShell
      expectedSlug="student"
      topbar={{ title: 'My Profile', desc: 'Your school record, guardians and ID card.' }}
    >
      {loading && <Card><SkeletonRows rows={5} /></Card>}

      {!loading && !overview && (
        <EmptyState
          title="No student record linked"
          sub="Contact the school office to link your student record to this login."
        />
      )}

      {!loading && overview && (
        <>
          <Card style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              {overview.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fileHref(overview.photoUrl)}
                  alt={overview.name}
                  className="profile-avatar-lg"
                  style={{ objectFit: 'cover', borderRadius: '50%' }}
                />
              ) : (
                <Avatar name={overview.name} className="profile-avatar-lg" />
              )}

              <label className="btn btn-soft btn-sm" style={{ cursor: photoBusy ? 'wait' : 'pointer' }}>
                {photoBusy ? 'Uploading…' : overview.photoUrl ? 'Change photo' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  disabled={photoBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = ''; // allows re-picking the same file after an error
                    if (file) void uploadPhoto(file);
                  }}
                />
              </label>
              {photoErr && <div style={{ fontSize: 11.5, color: '#991b1b', maxWidth: 160, textAlign: 'center' }}>{photoErr}</div>}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'Newsreader, serif', fontSize: 22, fontWeight: 600, color: 'var(--text-1b)' }}>
                {overview.name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>{overview.enrollment?.class ?? 'Not enrolled'}</span>
                {overview.enrollment?.rollNo != null && <Pill tone="blue">Roll {overview.enrollment.rollNo}</Pill>}
                {overview.attendance && <Pill tone={overview.attendance.pctPresent >= 75 ? 'green' : 'amber'}>
                  {overview.attendance.pctPresent}% attendance
                </Pill>}
              </div>
            </div>
          </Card>

          {(overview.enrollment?.classTeacher || overview.enrollment?.classRepresentative) && (
            <Card pad={false} style={{ marginBottom: 16 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)' }}>
                <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Your class</strong>
              </div>
              <table className="data-table data-table-cards">
                <tbody>
                  {overview.enrollment?.classTeacher && (
                    <tr>
                      <td className="cell-primary" data-label="Role" style={{ width: '38%' }}>Class teacher</td>
                      <td data-label="Name">
                        <span className="row-flex" style={{ flexWrap: 'wrap', gap: 8 }}>
                          {overview.enrollment.classTeacher.name}
                          {overview.enrollment.classTeacher.phone && (
                            <a href={`tel:${overview.enrollment.classTeacher.phone}`}>{overview.enrollment.classTeacher.phone}</a>
                          )}
                          {overview.enrollment.classTeacher.email && (
                            <a href={`mailto:${overview.enrollment.classTeacher.email}`}>{overview.enrollment.classTeacher.email}</a>
                          )}
                        </span>
                      </td>
                    </tr>
                  )}
                  {overview.enrollment?.classRepresentative && (
                    <tr>
                      <td className="cell-primary" data-label="Role">Class representative</td>
                      <td data-label="Name">{overview.enrollment.classRepresentative.name}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          )}

          <IdCardPanel studentId={overview.id} />

          <ProfileEditRequestPanel overview={overview} onApprovedChange={refresh} />

          <CoCurricularPanel />

          <Card pad={false} style={{ marginBottom: 16 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>School record</strong>
            </div>
            <table className="data-table data-table-cards">
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <td className="cell-primary" data-label="Field" style={{ width: '38%' }}>{label}</td>
                    <td data-label="Value">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card pad={false}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--hairline)' }}>
              <strong style={{ fontFamily: 'Newsreader, serif', fontSize: 17 }}>Guardians &amp; emergency contacts</strong>
            </div>
            {overview.guardians.length === 0 ? (
              <EmptyState
                icon="◌"
                title="No guardians on record"
                sub="Ask the school office to add a parent or guardian to your record."
              />
            ) : (
              <table className="data-table data-table-cards">
                <thead>
                  <tr><th>Name</th><th>Relation</th><th>Phone</th><th>Email</th></tr>
                </thead>
                <tbody>
                  {overview.guardians.map((g, i) => (
                    <tr key={`${g.name}-${i}`}>
                      <td className="cell-primary" data-label="Name">
                        <span className="row-flex">
                          {g.name}
                          {g.isPrimary && <Pill tone="green">Primary</Pill>}
                        </span>
                      </td>
                      <td data-label="Relation">{RELATION_LABEL[g.relation] ?? g.relation}</td>
                      <td data-label="Phone">{g.phone ? <a href={`tel:${g.phone}`}>{g.phone}</a> : '—'}</td>
                      <td data-label="Email">{g.email ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 14, lineHeight: 1.6 }}>
            Your admission number, class and roll number are set by the school office and cannot be
            changed by request — ask from <strong>Help &amp; Support</strong> if one of those is wrong.
            Everything else can be corrected through <strong>Request Edit</strong> above.
          </p>
        </>
      )}
    </PortalShell>
  );
}
