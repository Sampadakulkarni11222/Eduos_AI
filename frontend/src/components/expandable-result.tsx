'use client';
import { useState } from 'react';

/**
 * Display-only collapsing for a long collection in an assistant reply.
 *
 * The server sends every record the person is authorized to see; this decides
 * only how many are drawn at first. Nothing is ever dropped: "Read more"
 * reveals the rest, and the records themselves are never modified.
 *
 *   small (<= COLLAPSE_AFTER)  everything is shown, no control
 *   large                      the first PREVIEW_COUNT, then "Read more (N more)"
 *   very large                 each "Read more" adds up to REVEAL_STEP rows, so
 *                              thousands of rows are not put in the DOM at once;
 *                              the button stays until every row is visible
 *
 * One implementation for every list and table, whoever is asking -- the
 * collapsing knows nothing about roles or tools.
 */

/** A collection this long or shorter is shown whole. */
export const COLLAPSE_AFTER = 12;
/** How many rows a collapsed collection shows first. */
export const PREVIEW_COUNT = 10;
/** How many more rows one "Read more" reveals, at most. */
export const REVEAL_STEP = 500;

export interface Expansion {
  /** How many items to render right now. */
  visible: number;
  /** Whether the collection is long enough to be collapsible at all. */
  collapsible: boolean;
  /** Items not yet shown. */
  remaining: number;
  more: () => void;
  less: () => void;
}

export function useExpandable(total: number): Expansion {
  const collapsible = total > COLLAPSE_AFTER;
  const [visible, setVisible] = useState(collapsible ? PREVIEW_COUNT : total);
  const shown = collapsible ? Math.min(visible, total) : total;
  return {
    visible: shown,
    collapsible,
    remaining: total - shown,
    more: () => setVisible((v) => Math.min(total, v + REVEAL_STEP)),
    less: () => setVisible(PREVIEW_COUNT),
  };
}

/** The control under a collapsible collection. Renders nothing when there is nothing to collapse. */
export function ReadMore({ expansion, noun = 'items' }: { expansion: Expansion; noun?: string }) {
  if (!expansion.collapsible) return null;
  if (expansion.remaining > 0) {
    return (
      <button type="button" className="ai-read-more" onClick={expansion.more} aria-expanded={false}>
        Read more <span className="ai-read-more-count">({expansion.remaining} more {noun})</span>
      </button>
    );
  }
  return (
    <button type="button" className="ai-read-more" onClick={expansion.less} aria-expanded>
      Show less
    </button>
  );
}
