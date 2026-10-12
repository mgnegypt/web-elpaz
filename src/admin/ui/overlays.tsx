// Layered surfaces: modal dialogs, confirmations, side drawers and menus.
// All of them share one focus trap, one Escape handler and one scroll lock so
// keyboard and screen-reader behaviour is identical wherever they appear.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icons } from "../icons";
import { Button, IconButton } from "./primitives";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;

function lockScroll() {
  scrollLocks += 1;
  if (scrollLocks === 1) document.body.classList.add("is-locked");
  return () => {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.body.classList.remove("is-locked");
  };
}

/** Escape to close, Tab cycles inside, focus returns where it came from. */
function useOverlay(open: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const release = lockScroll();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const nodes = Array.from(
        panel.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((node) => node.offsetParent !== null || node === document.activeElement);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const frame = requestAnimationFrame(() => {
      const target =
        panel.current?.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]),textarea,select',
        ) ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      release();
      previous?.focus?.();
    };
  }, [open]);

  return panel;
}

/* ------------------------------------------------------------------- modal */

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
  closeLabel = "إغلاق",
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  closeLabel?: string;
}) {
  const panel = useOverlay(open, onClose);
  const titleId = useId();
  const descId = useId();

  if (!open) return null;

  return createPortal(
    <div
      className="dash modal-backdrop ui-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={`ui-modal ui-modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
      >
        <header className="ui-modal-head">
          <div className="ui-modal-heading">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descId}>{description}</p>}
          </div>
          <IconButton
            label={closeLabel}
            icon={<Icons.close size={18} />}
            onClick={onClose}
          />
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer && <footer className="ui-modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  detail?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      size="sm"
      onClose={busy ? () => {} : onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            loading={busy}
            icon={danger ? <Icons.trash size={16} /> : <Icons.check size={16} />}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={`confirm-body${danger ? " confirm-body--danger" : ""}`}>
        <span className="confirm-icon" aria-hidden="true">
          {danger ? <Icons.alert size={22} /> : <Icons.info size={22} />}
        </span>
        <div>
          <p className="confirm-text">{message}</p>
          {detail && <div className="confirm-detail">{detail}</div>}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ drawer */

/**
 * Side panel on desktop, bottom sheet on phones (handled in CSS). Head and
 * foot are flex children of a column layout — not sticky — so they never
 * overlap the page chrome underneath.
 */
export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  closeLabel = "إغلاق",
  width = "md",
  headExtra,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  width?: "md" | "lg";
  headExtra?: ReactNode;
}) {
  const panel = useOverlay(open, onClose);
  const titleId = useId();

  if (!open) return null;

  return createPortal(
    <div
      className="dash drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panel}
        className={`drawer drawer--${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="drawer-head">
          <div className="drawer-heading">
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <div className="drawer-head-tools">
            {headExtra}
            <IconButton
              label={closeLabel}
              icon={<Icons.close size={18} />}
              onClick={onClose}
            />
          </div>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------- menu */

export type MenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * Click-activated dropdown (never hover-only). Closes on Escape, outside
 * click, or selection, and returns focus to the trigger.
 */
export function Menu({
  label,
  items,
  trigger,
  align = "end",
}: {
  label: string;
  items: MenuItem[];
  trigger?: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  const close = useCallback((focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn icon-btn--ghost icon-btn--md"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? <Icons.more size={18} />}
      </button>
      {open && (
        <div className={`menu menu--${align}`} id={id} role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`menu-item${item.danger ? " menu-item--danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
