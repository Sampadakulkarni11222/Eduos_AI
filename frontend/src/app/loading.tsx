/**
 * Route-level loading state. Next.js streams this while a segment's server work
 * resolves, so navigation shows something immediately instead of appearing to
 * hang on the previous page.
 *
 * Deliberately minimal: individual screens already render their own skeletons
 * once mounted, so this only has to cover the gap before that happens.
 */
export default function Loading() {
  return (
    <div
      style={{
        minHeight: '50vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      role="status"
      aria-live="polite"
    >
      <span className="spinner" aria-hidden />
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        Loading…
      </span>
    </div>
  );
}
