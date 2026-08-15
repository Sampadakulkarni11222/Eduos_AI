'use client';
/**
 * Long body text that stays scannable in a list but can always be read in
 * full.
 *
 * Whether a "Read more" control appears is decided by *measuring* the rendered
 * paragraph, not by guessing from the source string. The previous version
 * offered the toggle whenever the text was long OR contained a newline, which
 * put a control on two-line notices that were never clipped — clicking it
 * revealed nothing. The clamp is applied first, then `scrollHeight` is
 * compared with `clientHeight`, so the toggle appears only when text is
 * genuinely hidden.
 *
 * Line breaks in the source are preserved (`white-space: pre-wrap`) — school
 * circulars are frequently written as several short paragraphs.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { cx } from './ui';

export function ExpandableText({
  text,
  clampLines = 3,
  className,
  style,
}: {
  text: string;
  /** How many lines to show before clamping. */
  clampLines?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const bodyId = useId();

  useEffect(() => {
    // Only measure while collapsed: expanding removes the clamp, which would
    // otherwise report "not clipped" and make the collapse control vanish.
    if (expanded) return;
    const el = ref.current;
    if (!el) return;

    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    check();

    // Re-check on resize — a notice that fits on a wide screen may clip on a
    // narrow one, and vice versa.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded, clampLines]);

  const showToggle = clipped || expanded;

  return (
    <>
      <p
        id={bodyId}
        ref={ref}
        className={cx('expandable-text', !expanded && 'is-clamped', className)}
        style={{ ...(style ?? {}), ...(expanded ? {} : { WebkitLineClamp: clampLines }) }}
      >
        {text}
      </p>
      {showToggle && (
        <button
          type="button"
          className="expandable-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </>
  );
}
