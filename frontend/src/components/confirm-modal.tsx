'use client';
import { Button } from '@/components/ui';

interface ConfirmModalProps {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible in-page confirmation dialog — replaces window.confirm() which
 * is blocked by many school network proxies and browser policies.
 */
export function ConfirmModal({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={onCancel}
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420 }}
      >
        <div className="modal-header">
          <div className="modal-title" id="confirm-modal-title">{title}</div>
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 20 }}>{body}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={onCancel}>{cancelLabel}</Button>
          <Button
            type="button"
            onClick={onConfirm}
            style={danger ? { background: 'var(--red)', color: '#fff' } : undefined}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
