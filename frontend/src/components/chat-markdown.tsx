'use client';
import { Fragment, ReactNode } from 'react';
import { ReadMore, useExpandable } from './expandable-result';

/**
 * Renders the assistant's Markdown replies.
 *
 * The server formats answers centrally (backend agent/present.js): a bold
 * heading, labelled bullets, a table where one helps. This turns that subset
 * into React elements. It never uses dangerouslySetInnerHTML -- every piece of
 * text ends up as a text node, so a reply containing "<script>" shows those
 * characters and runs nothing.
 *
 * Supported, and only what the assistant produces: paragraphs and line breaks,
 * **bold**, _italic_ / *italic*, `inline code`, fenced code blocks, # headings,
 * "- " / "* " / "• " bullets, "1. " numbered lists and GitHub-style tables.
 * Anything else is shown as the plain text it is.
 */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[]; start: number }
  | { kind: 'table'; headers: string[]; align: Array<'left' | 'right' | 'center'>; rows: string[][] }
  | { kind: 'code'; text: string };

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/;
const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
// Up to five digits: a list of more than 999 items is still one list.
const NUMBERED = /^\s*(\d{1,5})[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

export function parseBlocks(markdown: string): Block[] {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const headers = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        c.endsWith(':') && c.startsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left') as Array<'left' | 'right' | 'center'>;
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push({ kind: 'table', headers, align, rows });
      continue;
    }

    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i])) items.push(BULLET.exec(lines[i++])![1]);
      blocks.push({ kind: 'ul', items });
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      const items: string[] = [];
      while (i < lines.length && NUMBERED.test(lines[i])) items.push(NUMBERED.exec(lines[i++])![2]);
      blocks.push({ kind: 'ol', items, start: Number(numbered[1]) });
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim()
      && !HEADING.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !/^\s*```/.test(lines[i])
      && !(TABLE_ROW.test(lines[i]) && TABLE_SEP.test(lines[i + 1] ?? ''))
    ) para.push(lines[i++]);
    blocks.push({ kind: 'paragraph', lines: para });
  }
  return blocks;
}

/** Inline marks: `code` first (its contents are literal), then **bold**, then _italic_. */
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(__[^_\n]+?__)|(\*[^*\s][^*\n]*?\*)|(\b_[^_\n]+?_\b)/g;

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = m[0];
    const key = `${keyPrefix}-${n++}`;
    if (m[1]) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (m[2] || m[3]) out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    else out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * A list, collapsed behind "Read more" when it is long. Every item is in
 * `items`; only how many are drawn changes. An ordered list keeps its own
 * numbering, so item 11 is still "11." after expanding.
 */
function ListBlock({ block, blockKey }: { block: Extract<Block, { kind: 'ul' | 'ol' }>; blockKey: string }) {
  const expansion = useExpandable(block.items.length);
  const items = block.items.slice(0, expansion.visible).map((item, k) => (
    <li key={k}>{renderInline(item, `${blockKey}-${k}`)}</li>
  ));
  return (
    <div className="ai-md-collection">
      {block.kind === 'ol' ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>}
      <ReadMore expansion={expansion} />
    </div>
  );
}

/** A table, collapsed behind "Read more" when it has many rows. The header row always stays. */
function TableBlock({ block, blockKey }: { block: Extract<Block, { kind: 'table' }>; blockKey: string }) {
  const expansion = useExpandable(block.rows.length);
  return (
    <div className="ai-md-collection">
      <div className="ai-md-table">
        <table>
          <thead>
            <tr>{block.headers.map((h, k) => <th key={k} scope="col" style={{ textAlign: block.align[k] ?? 'left' }}>{renderInline(h, `${blockKey}-h${k}`)}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.slice(0, expansion.visible).map((row, r) => (
              <tr key={r}>
                {row.map((c, k) => <td key={k} style={{ textAlign: block.align[k] ?? 'left' }}>{renderInline(c, `${blockKey}-${r}-${k}`)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ReadMore expansion={expansion} noun="rows" />
    </div>
  );
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="ai-md">
      {blocks.map((block, b) => {
        const key = `b${b}`;
        switch (block.kind) {
          case 'heading':
            return <p key={key} className="ai-md-heading" role="heading" aria-level={Math.min(block.level + 2, 6)}>{renderInline(block.text, key)}</p>;
          case 'ul':
          case 'ol':
            return <ListBlock key={key} block={block} blockKey={key} />;
          case 'code':
            return <pre key={key}><code>{block.text}</code></pre>;
          case 'table':
            return <TableBlock key={key} block={block} blockKey={key} />;
          default:
            return (
              <p key={key}>
                {block.lines.map((line, k) => (
                  <Fragment key={k}>{k > 0 && <br />}{renderInline(line, `${key}-${k}`)}</Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
