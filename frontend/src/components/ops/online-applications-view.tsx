'use client';
import { useParams } from 'next/navigation';
import { EmptyState } from '@/components/ui';
import { onlineApplicationsApi } from '@/lib/green-api';
import { Attachments, DataNote, Loadable, SectionCard, StatusPill, fmtDate, fmtDateTime, useLoad } from './kit';

/**
 * Applications made through the school's public online admission form. Each
 * one is already a NEW lead in the admissions CRM (source WEB), where it is
 * worked; this list adds what the family sent and their documents.
 */
export function OnlineApplicationsView() {
  const params = useParams<{ school?: string }>();
  const school = typeof params?.school === 'string' ? params.school : '';
  const state = useLoad(() => onlineApplicationsApi.list({ pageSize: 100 }), []);
  const formPath = `/public/admission/${school}`;
  return (
    <Loadable state={state}>
      {(d) => (
        <SectionCard title={`Online applications (${d.total})`} sub="Each application is a NEW lead in the admissions CRM. No fee is collected through the form.">
          <DataNote>The public form for families: <a href={formPath} target="_blank" rel="noreferrer">{formPath}</a>. Share this link on the school website.</DataNote>
          {d.items.length === 0 ? <EmptyState icon="✉" title="No online applications yet" sub="Applications made on the public form appear here and in the CRM." /> : (
            <div className="ops-table-wrap"><table className="ops-table">
              <thead><tr><th>Reference</th><th>Child</th><th>Class</th><th>Parent / guardian</th><th>Received</th><th>Stage</th><th>Documents</th></tr></thead>
              <tbody>{d.items.map((a) => (
                <tr key={a.id}>
                  <td>{a.refNo}</td>
                  <td><b>{a.childName}</b>{a.dateOfBirth && <div className="ops-muted">Born {fmtDate(a.dateOfBirth)}</div>}</td>
                  <td>{a.gradeApplying ?? '—'}</td>
                  <td>{a.guardianName}<div className="ops-muted">{a.phone}{a.email ? ` · ${a.email}` : ''}</div></td>
                  <td>{fmtDateTime(a.createdAt)}</td>
                  <td><StatusPill status={a.stage ?? 'NEW'} label={a.publicStatus ?? undefined} /></td>
                  <td><Attachments items={a.documents.map((x) => ({ name: x.name, url: x.url }))} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </SectionCard>
      )}
    </Loadable>
  );
}
