'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import type { LearnResult, MindMapNode } from '@/lib/types';
import { Text, bodyStyle, stack } from './shared';

type MindMap = Extract<LearnResult, { type: 'mindmap' }>;

/**
 * The mind map as a collapsible tree. Every node is a real list item with a
 * text label, so the tree is its own text alternative for a screen reader.
 * It uses the disclosure pattern — nested lists whose toggle buttons carry
 * aria-expanded — not ARIA role="tree", which would promise arrow-key
 * navigation and selection this component does not implement. The
 * "outline" toggle gives the same structure as plain indented text for anyone
 * who wants to copy it into their notes.
 *
 * Node identity is its path of child indices ("0.2.1") — stable for the life
 * of one result, which is all the expanded-set needs.
 */
export function MindMapView({ result }: { result: MindMap }) {
  const allPaths = useMemo(() => collectPaths(result.root), [result.root]);
  // Root and its branches start open; deeper levels start closed.
  const [open, setOpen] = useState<Set<string>>(() => new Set(allPaths.filter((p) => p.split('.').length <= 2)));
  const [outline, setOutline] = useState(false);

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });

  return (
    <div style={{ ...stack(), ...bodyStyle }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button small variant="soft" onClick={() => setOpen(new Set(allPaths))}>Expand all</Button>
        <Button small variant="soft" onClick={() => setOpen(new Set(['0']))}>Collapse all</Button>
        <Button small variant="ghost" aria-pressed={outline} onClick={() => setOutline((o) => !o)}>
          {outline ? 'Show as tree' : 'Show as text outline'}
        </Button>
      </div>

      {outline ? (
        <pre aria-label="Mind map outline" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>
          {toOutline(result.root)}
        </pre>
      ) : (
        <ul aria-label="Mind map" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          <Node node={result.root} path="0" depth={0} open={open} toggle={toggle} />
        </ul>
      )}
    </div>
  );
}

function Node({ node, path, depth, open, toggle }: {
  node: MindMapNode; path: string; depth: number; open: Set<string>; toggle: (p: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && open.has(path);
  const styles = [
    { fontSize: 16, fontWeight: 700, background: 'var(--accent)', color: 'var(--on-accent, #fff)' },
    { fontSize: 14, fontWeight: 600, background: 'var(--panel-bg)', color: 'var(--text-1)' },
    { fontSize: 13.5, fontWeight: 500, background: 'var(--card-bg)', color: 'var(--text-1)' },
    { fontSize: 13, fontWeight: 400, background: 'var(--card-bg)', color: 'var(--text-2)' },
  ];
  const s = styles[Math.min(depth, styles.length - 1)];

  return (
    <li style={{ margin: '6px 0' }}>
      {hasChildren ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => toggle(path)}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`}
          style={{ ...pill, ...s, cursor: 'pointer' }}
        >
          <span aria-hidden="true" style={{ marginRight: 6, fontSize: 10 }}>{expanded ? '▾' : '▸'}</span>
          <Text>{node.label}</Text>
        </button>
      ) : (
        <span style={{ ...pill, ...s }}><Text>{node.label}</Text></span>
      )}
      {expanded && (
        <ul style={{ listStyle: 'none', margin: '0 0 0 14px', padding: '0 0 0 14px', borderLeft: '2px solid var(--hairline-2)' }}>
          {node.children.map((child, i) => (
            <Node key={i} node={child} path={`${path}.${i}`} depth={depth + 1} open={open} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: '5px 12px', borderRadius: 10,
  border: '1px solid var(--hairline-2)', font: 'inherit', textAlign: 'left',
};

function collectPaths(node: MindMapNode, path = '0'): string[] {
  return [path, ...node.children.flatMap((c, i) => collectPaths(c, `${path}.${i}`))];
}

export function toOutline(node: MindMapNode, depth = 0): string {
  const line = `${'    '.repeat(depth)}${depth ? '• ' : ''}${node.label}`;
  return [line, ...node.children.map((c) => toOutline(c, depth + 1))].join('\n');
}
