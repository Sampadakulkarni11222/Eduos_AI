'use client';
import Link from 'next/link';
import { usePortalHref } from '@/lib/school-path';

/**
 * "Based on": the source records behind a piece of AI-written or generated
 * text (an assistant answer, the briefing, a draft). Every item says what was
 * read, how many records, for whom and when, with a link to where they live,
 * so no statement is shown without its evidence.
 */
export interface EvidenceItem { text: string; link?: string | null }

export function EvidenceFooter({ items, title = 'Based on', note }: { items?: EvidenceItem[] | null; title?: string; note?: string }) {
  const href = usePortalHref();
  if (!items?.length && !note) return null;
  return (
    <div className="evidence-footer" role="note" aria-label={title}>
      <span className="evidence-title">{title}:</span>
      {note && <span className="evidence-note"> {note}</span>}
      {!!items?.length && (
        <ul className="evidence-list">
          {items.map((e, i) => (
            <li key={i}>{e.link ? <Link href={href(e.link)}>{e.text}</Link> : e.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
