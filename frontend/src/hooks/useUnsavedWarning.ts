import { useEffect } from 'react';

/**
 * Warns the user before navigating away when there are unsaved changes.
 *
 * Pass a boolean `isDirty` — it must be a React state variable (not a ref)
 * so changes to it actually re-run this effect.
 *
 * The browser's built-in beforeunload dialog fires for tab/window close and
 * hard navigation. Modern browsers show a generic "Leave site?" prompt;
 * the custom message string is ignored for security reasons.
 */
export function useUnsavedWarning(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome requires returnValue to be set to trigger the dialog.
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}
