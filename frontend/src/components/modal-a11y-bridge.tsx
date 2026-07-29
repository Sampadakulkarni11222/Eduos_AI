'use client';
import { useEffect } from 'react';

/**
 * Accessibility bridge for legacy modal markup.
 *
 * ~20 screens still render dialogs as raw `<div className="modal-overlay">`
 * markup rather than the <Modal> primitive, and none of them expose dialog
 * semantics, trap focus, or close on Escape. Rewriting all of them at once is
 * a large, risky diff; this observes the DOM instead and applies the same
 * behaviour to any `.modal` that appears, so keyboard and screen-reader users
 * are not left waiting on that migration.
 *
 * Deliberately additive: it never overrides attributes a component already set,
 * so a screen migrated to <Modal> is left completely alone. Delete this once
 * `grep -rl "modal-overlay"` comes back empty.
 */
export function ModalA11yBridge() {
  useEffect(() => {
    const topMost = () => {
      const panels = document.querySelectorAll<HTMLElement>('.modal, .side-panel, .ai-panel');
      return panels.length ? panels[panels.length - 1] : null;
    };

    const focusablesIn = (panel: HTMLElement) =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);

    let lastFocused: HTMLElement | null = null;

    const enhance = (panel: HTMLElement) => {
      if (panel.dataset.a11yBridged === '1') return;
      panel.dataset.a11yBridged = '1';

      // Never clobber what a properly-built dialog already declares.
      if (!panel.getAttribute('role')) panel.setAttribute('role', 'dialog');
      if (!panel.getAttribute('aria-modal')) panel.setAttribute('aria-modal', 'true');

      if (!panel.getAttribute('aria-label') && !panel.getAttribute('aria-labelledby')) {
        const title = panel.querySelector('.modal-title, .side-panel-head, .ai-title')?.textContent?.trim();
        if (title) panel.setAttribute('aria-label', title);
      }

      lastFocused = document.activeElement as HTMLElement | null;
      const first = focusablesIn(panel)[0];
      if (first) {
        first.focus();
      } else {
        panel.setAttribute('tabindex', '-1');
        panel.focus();
      }
    };

    const observer = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          const panel = n.matches?.('.modal, .side-panel, .ai-panel')
            ? n
            : n.querySelector<HTMLElement>('.modal, .side-panel, .ai-panel');
          if (panel) enhance(panel);
        });
        r.removedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          const wasPanel = n.matches?.('.modal, .side-panel, .ai-panel') || n.querySelector?.('.modal, .side-panel, .ai-panel');
          // Only restore focus once the last dialog has gone.
          if (wasPanel && !topMost() && lastFocused?.isConnected) {
            lastFocused.focus();
            lastFocused = null;
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const onKeyDown = (e: KeyboardEvent) => {
      const panel = topMost();
      if (!panel) return;

      if (e.key === 'Escape') {
        // Use the dialog's own close affordance so its state updates normally;
        // a component that deliberately blocks closing simply has no button.
        const closer = panel.querySelector<HTMLElement>('.modal-close, [data-modal-close]');
        if (closer && !(closer as HTMLButtonElement).disabled) {
          e.preventDefault();
          closer.click();
        }
        return;
      }

      if (e.key !== 'Tab') return;
      const items = focusablesIn(panel);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // Focus escaping the dialog (or starting outside it) is pulled back in.
      if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  return null;
}
