import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

export type DialogProps = {
  open: boolean;
  /** Escape, backdrop click, close button. */
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
  actions?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/* Same mechanism as the landing sign-in dialog: always mounted, `open` drives
 * showModal()/close(). A `close` event while `open` is still true means the
 * browser closed it natively, so the parent is told. The browser returns
 * focus to the opener on close. */
export default function Dialog({
  open,
  onClose,
  title,
  closeLabel,
  children,
  actions,
  initialFocusRef,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocusRef]);

  return (
    <dialog
      ref={ref}
      className="ui-dialog"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onClose={() => {
        // A native close the cancel handler did not stop: keep the parent in step.
        if (open) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <button type="button" className="ui-dialog-close" aria-label={closeLabel} onClick={onClose}>
        ×
      </button>
      {/* Content is unmounted on close, so an exit fade would show an empty dialog. */}
      {open && (
        <div className="ui-dialog-body">
          <h2 id={titleId} className="ui-dialog-title">
            {title}
          </h2>
          {children}
          {actions && <div className="ui-dialog-actions">{actions}</div>}
        </div>
      )}
    </dialog>
  );
}
