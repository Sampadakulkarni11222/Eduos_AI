/**
 * How a bulk-import preview and outcome read to a person -- on the website as
 * Markdown, on WhatsApp as short text. Built only from the analysis itself
 * (counts, the columns as matched, each row's problem), so nothing said is
 * not in the result.
 */

const MAX_LISTED = 12;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function problemLine(p) {
  const where = [`Row ${p.row}`, p.column && `${p.column}${p.value ? ` "${p.value}"` : ''}`].filter(Boolean).join(', ');
  return `${where}: ${p.problem}${p.suggestion ? ` — ${p.suggestion}` : ''}`;
}

export function templatePaths(key) {
  return { xlsx: `/imports/templates/${key}.xlsx`, csv: `/imports/templates/${key}.csv` };
}

/** The download buttons that go with a preview. */
export function downloadsFor(view) {
  const out = [];
  if (view?.status === 'HAS_PROBLEMS' && view.file?.id) {
    out.push({ label: 'Error report (rows to fix)', path: `/imports/files/${view.file.id}/errors.xlsx`, filename: `${String(view.file.name ?? 'sheet').replace(/\.[^.]+$/, '')}-errors.xlsx` });
  }
  if (view?.target?.key && ['HAS_PROBLEMS', 'WRONG_FORMAT'].includes(view.status)) {
    out.push({ label: `Sample sheet: ${view.target.label}`, path: templatePaths(view.target.key).xlsx, filename: `${view.target.key}-template.xlsx` });
  }
  if (view?.status === 'ASK_TARGET') {
    for (const o of view.options ?? []) out.push({ label: `Sample sheet: ${o.label}`, path: templatePaths(o.key).xlsx, filename: `${o.key}-template.xlsx` });
  }
  return out;
}

function mappingLine(view) {
  const mapped = (view.mapping ?? []).map((m) => (m.exact || m.header.toLowerCase() === m.label.toLowerCase() ? m.label : `"${m.header}" → ${m.label}`));
  const parts = [];
  if (mapped.length) parts.push(`Columns: ${mapped.join(', ')}`);
  if (view.melted?.length) parts.push(`one paper per subject column (${view.melted.join(', ')})`);
  if (view.ignored?.length) parts.push(`ignored: ${view.ignored.map((h) => `"${h}"`).join(', ')}`);
  const said = Object.entries(view.context ?? {}).filter(([k]) => ['className', 'date', 'exam', 'subject', 'roleKey'].includes(k));
  if (said.length) parts.push(`from your message: ${said.map(([k, v]) => `${{ className: 'class', date: 'date', exam: 'exam', subject: 'subject', roleKey: 'role' }[k]} ${v}`).join(', ')}`);
  return parts.join('; ');
}

/**
 * The preview as text. `channel` WHATSAPP drops the Markdown table-ish detail
 * and keeps it short; the website gets the full list of problems shown.
 */
export function previewText(view, { channel = 'WEB' } = {}) {
  const wa = channel === 'WHATSAPP';
  const name = view.file?.name ?? 'the sheet';
  switch (view.status) {
    case 'ALREADY_IMPORTED':
      return `${name} was already imported${view.result?.imported != null ? ` (${plural(view.result.imported, 'row')} into ${view.result?.target?.label ?? 'the school'})` : ''}. Nothing was changed again.`;
    case 'NOT_PERMITTED':
      return `${view.message}${view.formats?.length ? ` You can import: ${view.formats.map((f) => f.label).join(', ')}.` : ''}`;
    case 'UNKNOWN_FORMAT':
      return `${view.message} It has the columns ${(view.file?.headers ?? []).slice(0, 10).map((h) => `"${h}"`).join(', ')}. `
        + `Tell me where it should go${view.formats?.length ? ` — ${view.formats.map((f) => f.label).join(', ')}` : ''} — and I will check it against that format.`;
    case 'ASK_TARGET':
      return `${view.message} Reply with ${view.options.map((o) => `"${o.label}"`).join(' or ')}.`;
    case 'WRONG_FORMAT': {
      const sayable = view.missing.filter((m) => m.canSay);
      const columns = view.missing.filter((m) => !m.canSay);
      const lines = [`**${name}** looks like **${view.target.label}**, but it is not in the right format yet.`];
      if (columns.length) lines.push(`Missing column${columns.length === 1 ? '' : 's'}: ${columns.map((m) => `**${m.label}**${m.note ? ` (${m.note})` : ''}`).join('; ')}.`);
      if (sayable.length) lines.push(`Or tell me the ${sayable.map((m) => m.label.toLowerCase()).join(' and ')} in your message, e.g. "${sayable.map((m) => ({ className: 'Class 6 A', date: 'for today', exam: 'Unit Test 1', subject: 'Mathematics', roleKey: 'teachers' }[m.key] ?? m.label)).join(', ')}".`);
      const map = mappingLine(view);
      if (map && !wa) lines.push(map);
      lines.push(wa
        ? 'Fix the sheet and send it again. A sample sheet is on the website in Ask AI.'
        : 'Download the sample sheet below, copy your data into it (or rename your columns), and upload it again.');
      return lines.join('\n\n');
    }
    case 'READY':
    case 'HAS_PROBLEMS': {
      const c = view.counts;
      const lines = [`**${name}** → **${view.target.label}** (${plural(c.total, 'row')})`];
      const map = mappingLine(view);
      if (map && !wa) lines.push(map);
      const tally = [`${c.ready} ready`];
      if (c.problems) tally.push(`${c.problems} with problems`);
      if (c.skipped) tally.push(`${c.skipped} skipped (already in)`);
      lines.push(tally.join(' · '));
      if (view.problems?.length) {
        const shown = view.problems.slice(0, wa ? 5 : MAX_LISTED);
        lines.push(shown.map((p) => `- ${problemLine(p)}`).join('\n')
          + ((view.problemsTotal ?? view.problems.length) > shown.length ? `\n- …and ${(view.problemsTotal ?? view.problems.length) - shown.length} more in the error report` : ''));
      }
      if (view.skipped?.length && !wa) lines.push(`Skipped: ${view.skipped.slice(0, 5).map((s) => `row ${s.row} (${s.reason})`).join('; ')}${view.skipped.length > 5 ? '…' : ''}`);
      if (view.status === 'HAS_PROBLEMS' && !wa) {
        lines.push(c.ready
          ? `You can **import the ${plural(c.ready, 'valid row')}** now (say "import the valid rows"), or download the error report, fix the rows marked and upload it again. The sample sheet is there for reference.`
          : 'No row is ready yet. Download the error report, fix the rows marked (the sample sheet shows the format) and upload it again.');
      }
      if (c.ready === 0 && view.status === 'READY') lines.push('Every row is already in, so there is nothing to import.');
      return lines.join('\n\n');
    }
    default:
      return view.message ?? 'I checked the file.';
  }
}

/** The finished import as text. */
export function resultText(result) {
  if (result.alreadyImported) {
    return `This file was already imported${result.at ? ` on ${String(result.at).slice(0, 10)}` : ''}: ${plural(result.imported ?? 0, 'row')} into ${result.target?.label ?? 'the school'}. Nothing was imported again.`;
  }
  const lines = [`Uploaded successfully: **${plural(result.imported, 'row')}** imported into **${result.target.label}** from ${result.fileName}.`];
  const left = [];
  if (result.notImported) left.push(`${result.notImported} left out (problems)`);
  if (result.failed) left.push(`${result.failed} refused when saving`);
  if (result.skipped) left.push(`${result.skipped} already in`);
  if (left.length) lines.push(`${left.join(' · ')}. ${result.hasErrorReport ? 'The error report lists them; fix those rows and upload them again — rows already imported are skipped.' : ''}`.trim());
  if (result.failed && result.errors?.length) {
    const saved = result.errors.filter((e) => e.row).slice(-5);
    if (saved.length) lines.push(saved.map((e) => `- Row ${e.row}: ${e.problem}`).join('\n'));
  }
  return lines.join('\n\n');
}
