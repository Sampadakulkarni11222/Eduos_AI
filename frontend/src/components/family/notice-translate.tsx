'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { ExpandableText } from '@/components/expandable-text';
import { familyApi, type FamilyLanguage, type NoticeTranslationDto } from '@/lib/family-api';

let languagesCache: Promise<FamilyLanguage[]> | null = null;
let preferredCache: Promise<string> | null = null;
const languages = () => (languagesCache ??= familyApi.languages().catch(() => []));
const preferred = () => (preferredCache ??= familyApi.preferences().then((p) => p.language).catch(() => 'en'));

/**
 * "Read in my language" under a school notice: the AI translation, labelled,
 * with the English notice kept above it as the official text. Shown to
 * families; without an AI service the button says so instead of pretending.
 */
export function NoticeTranslate({ announcementId }: { announcementId: string }) {
  const [langs, setLangs] = useState<FamilyLanguage[]>([]);
  const [lang, setLang] = useState('hi');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<NoticeTranslationDto | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void languages().then((l) => setLangs(l.filter((x) => x.code !== 'en')));
    void preferred().then((p) => { if (p && p !== 'en') setLang(p); });
  }, []);

  const run = async () => {
    setBusy(true); setErr(null);
    try { setOut(await familyApi.translateNotice(announcementId, lang)); } catch { setErr('Could not translate this notice right now.'); } finally { setBusy(false); }
  };

  if (!langs.length) return null;
  return (
    <div className="notice-tr">
      <div className="notice-tr-bar">
        <select className="input" value={lang} onChange={(e) => { setLang(e.target.value); setOut(null); }} aria-label="Language to read this notice in">
          {langs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
        <Button small variant="soft" onClick={() => void run()} disabled={busy}>{busy ? 'Translating…' : 'Read in my language'}</Button>
      </div>
      {err && <p className="notice-tr-label">{err}</p>}
      {out && (out.available ? (
        <div className="notice-tr-body" lang={out.lang}>
          <strong>{out.title}</strong>
          <ExpandableText text={out.content ?? ''} clampLines={6} />
          <p className="notice-tr-label">{out.label}</p>
        </div>
      ) : <p className="notice-tr-label">{out.label}</p>)}
    </div>
  );
}
