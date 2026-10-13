'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Side drawer for a record's detail (dashboard reference: the right-hand
 * panel that opens on a selected item). Dialog semantics, Escape to close,
 * focus moved in and returned, focus kept inside while open.
 */
export function Drawer({ title, sub, onClose, children, footer }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <>
      <div className="ops-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <div ref={ref} className="ops-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ops-drawer-head">
          <div>
            <div className="ops-drawer-title" id={titleId}>{title}</div>
            {sub && <div className="ops-drawer-sub">{sub}</div>}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ops-drawer-body">{children}</div>
        {footer && <div className="ops-drawer-foot">{footer}</div>}
      </div>
    </>
  );
}
