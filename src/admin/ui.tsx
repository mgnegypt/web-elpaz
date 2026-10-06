// Reusable dashboard primitives. Everything the panels need comes from here so
// spacing, focus states, radii and animation stay identical across screens.
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ApiFailure, adminApi, type StoredUpload } from "./api";
import { Icons } from "./icons";

/* ------------------------------------------------------------------ layout */

export function Card({
  title,
  description,
  icon,
  actions,
  children,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div className="card-heading">
            {icon && <span className="card-icon">{icon}</span>}
            <div>
              {title && <h2 className="card-title">{title}</h2>}
              {description && <p className="card-desc">{description}</p>}
            </div>
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={padded ? "card-body" : "card-body card-body--flush"}>
        {children}
      </div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Grid({
  columns = 2,
  children,
  className = "",
}: {
  columns?: 1 | 2 | 3;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ui-grid ui-grid--${columns} ${className}`}>{children}</div>
  );
}

/* ----------------------------------------------------------------- buttons */

type ButtonProps = {
  children?: ReactNode;
  variant?: "primary" | "soft" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  className?: string;
  block?: boolean;
  "aria-label"?: string;
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  trailingIcon,
  loading = false,
  disabled = false,
  type = "button",
  onClick,
  title,
  className = "",
  block = false,
  "aria-label": ariaLabel,
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn--${variant} btn--${size}${block ? " btn--block" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <Icons.loader size={size === "sm" ? 15 : 17} className="spin" />
      ) : (
        icon
      )}
      {children && <span>{children}</span>}
      {trailingIcon}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  onClick,
  variant = "ghost",
  disabled,
  size = "md",
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  variant?: "ghost" | "soft" | "danger";
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--${variant} icon-btn--${size}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

/* ------------------------------------------------------------------ inputs */

/**
 * Label + control + hint/error. A single control child is given the generated
 * id so the label is programmatically associated with it (screen readers and
 * `getByLabel` both rely on this).
 */
export function Field({
  label,
  hint,
  error,
  children,
  required,
  htmlFor,
  className = "",
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const only = Children.count(children) === 1 ? Children.only(children) : null;
  const single = isValidElement(only)
    ? (only as ReactElement<{ id?: string; required?: boolean }>)
    : null;
  // Composite controls (option groups, custom widgets) get a plain caption.
  const control = single
    ? cloneElement(single, { id, required: required || undefined })
    : children;
  // The asterisk is decorative: `required` is announced by the control itself.
  // The required marker sits outside the <label> so the label text (and with it
  // the control's accessible name) stays exactly the human label.
  const requiredMark = required ? (
    <span className="field-req" aria-hidden="true">
      *
    </span>
  ) : null;
  return (
    <div className={`field ${className}`}>
      {label && (
        <span className="field-label-row">
          {single ? (
            <label className="field-label" htmlFor={id}>
              {label}
            </label>
          ) : (
            <span className="field-label">{label}</span>
          )}
          {requiredMark}
        </span>
      )}
      {control}
      {error ? (
        <p className="field-error">
          <Icons.error size={14} />
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  type = "text",
  placeholder,
  dir,
  id,
  autoComplete,
  disabled,
  maxLength,
  onBlur,
  invalid,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  dir?: "rtl" | "ltr";
  id?: string;
  autoComplete?: string;
  disabled?: boolean;
  maxLength?: number;
  onBlur?: () => void;
  invalid?: boolean;
  /** Set by <Field>; keeps required semantics on the control, not the label. */
  required?: boolean;
}) {
  return (
    <input
      id={id}
      className={`input${invalid ? " input--invalid" : ""}`}
      value={value}
      type={type}
      dir={dir}
      placeholder={placeholder}
      autoComplete={autoComplete}
      disabled={disabled}
      maxLength={maxLength}
      onBlur={onBlur}
      required={required}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  placeholder,
  id,
  maxLength,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  id?: string;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <textarea
      id={id}
      required={required}
      className="input textarea"
      rows={rows}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  id,
  disabled,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <div className="select-wrap">
      <select
        id={id}
        required={required}
        className="input select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icons.chevronDown size={16} className="select-caret" />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="switch-row">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`switch${checked ? " switch--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
      <div className="switch-text">
        <label htmlFor={id} className="switch-label">
          {label}
        </label>
        {hint && <p className="field-hint">{hint}</p>}
      </div>
    </div>
  );
}

/** Radio-style option cards (e.g. product availability). */
export function OptionGroup<T extends string>({
  value,
  onChange,
  options,
  columns = 2,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint?: string; icon?: ReactNode }[];
  columns?: 1 | 2;
}) {
  return (
    <div className={`option-group option-group--${columns}`} role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`option${value === option.value ? " option--active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <span className="option-icon">{option.icon}</span>}
          <span className="option-text">
            <strong>{option.label}</strong>
            {option.hint && <small>{option.hint}</small>}
          </span>
          {value === option.value && (
            <Icons.check size={16} className="option-check" />
          )}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ badges */

export function Badge({
  children,
  tone = "neutral",
  icon,
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "red" | "amber" | "blue" | "violet";
  icon?: ReactNode;
}) {
  return (
    <span className={`badge badge--${tone}`}>
      {icon}
      {children}
    </span>
  );
}

export function StatusDot({
  online,
  label,
}: {
  online: boolean;
  label: string;
}) {
  return (
    <span
      className={`status-dot${online ? " status-dot--online" : " status-dot--offline"}`}
    >
      {online ? <Icons.online size={14} /> : <Icons.offline size={14} />}
      {label}
    </span>
  );
}

/* ------------------------------------------------------------- placeholders */

export function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
  className = "",
}: {
  width?: string | number;
  height?: number;
  radius?: number;
  className?: string;
}) {
  return (
    <span
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="glass-card skeleton-card" aria-hidden="true">
      <Skeleton width="42%" height={18} />
      <div className="skeleton-lines">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} width={index % 2 ? "72%" : "88%"} height={12} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="glass-card skeleton-card">
          <Skeleton height={132} radius={14} />
          <Skeleton width="60%" height={16} />
          <Skeleton width="82%" height={11} />
          <Skeleton width="44%" height={11} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <span className="empty-icon">{icon}</span>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
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
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    // Focus the first control so keyboard users land inside the dialog.
    requestAnimationFrame(() => {
      panel.current
        ?.querySelector<HTMLElement>("input, select, textarea, button")
        ?.focus();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop ui-modal-backdrop"
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
      >
        <header className="ui-modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton
            label="إغلاق"
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
  confirmLabel = "تأكيد",
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
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
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            إلغاء
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            loading={busy}
            icon={
              danger ? <Icons.trash size={16} /> : <Icons.check size={16} />
            }
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="confirm-text">{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ toasts */

type Toast = { id: number; tone: "success" | "error" | "info"; text: string };
type ToastApi = { push: (tone: Toast["tone"], text: string) => void };

const ToastContext = createContext<ToastApi>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current.slice(-3), { id, tone, text }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast--${item.tone}`}>
            {item.tone === "success" ? (
              <Icons.checkCircle size={17} />
            ) : item.tone === "error" ? (
              <Icons.error size={17} />
            ) : (
              <Icons.info size={17} />
            )}
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Specific, actionable messages for the error codes the API returns. */
const ERROR_MESSAGES: Record<string, string> = {
  "invalid-current-answer": "الإجابة الحالية غير صحيحة.",
  "invalid-current-password": "كلمة المرور الحالية غير صحيحة.",
  "invalid-security-answer": "إجابة سؤال الأمان غير صحيحة.",
  "invalid-credentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "email-taken": "البريد الإلكتروني مستخدم بالفعل.",
  "username-taken": "اسم المستخدم مستخدم بالفعل.",
  "last-owner": "لا يمكن إزالة صلاحية آخر حساب مالك.",
  "cannot-delete-self": "لا يمكنك حذف حسابك الحالي.",
  "profile-incomplete": "أكمل بيانات حسابك أولًا.",
  "unsupported-type":
    "صيغة الملف غير مدعومة. المسموح: PNG أو JPG أو JPEG أو GIF أو WebP.",
  "file-too-large": "حجم الصورة كبير. الحد الأقصى ٥ ميجابايت.",
  "no-file": "لم يتم اختيار ملف.",
  "empty-file": "الملف فارغ.",
  "upload-failed": "تعذّر رفع الصورة. حاول مرة أخرى.",
  "revision-conflict":
    "عُدّل المحتوى من مكان آخر — حدّث الصفحة وحاول مرة أخرى.",
  "too-many-requests": "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.",
  "too-many-attempts":
    "محاولات دخول خاطئة كثيرة على هذا الحساب. انتظر قليلًا ثم أعد المحاولة.",
  "password-too-common":
    "كلمة المرور شائعة جدًا وسهلة التخمين. اختر كلمة مرور أقوى.",
  "password-too-simple": "كلمة المرور بسيطة جدًا. اختر كلمة مرور أقوى.",
  "password-matches-account":
    "كلمة المرور لا يجب أن تحتوي على اسم المستخدم أو البريد الإلكتروني.",
  "password-too-short": "كلمة المرور يجب ألا تقل عن ١٢ حرفًا.",
  "request-key-conflict": "تم إرسال طلب مختلف بنفس المفتاح. أعد المحاولة.",
  "image-host-not-allowed": "رابط الصورة من نطاق غير مسموح به في هذا الإعداد.",
  "payload-too-large": "البيانات المرسلة كبيرة جدًا.",
  "invalid-json": "تعذّر قراءة البيانات المرسلة.",
  "invalid-product": "راجع بيانات المنتج.",
  "invalid-event": "راجع بيانات المناسبة.",
  "owner-only": "ليست لديك صلاحية لهذا الإجراء.",
  "csrf-rejected": "انتهت صلاحية الجلسة. حدّث الصفحة ثم أعد المحاولة.",
};

/** Turns any thrown value into a message the dashboard can show the operator. */
export function describeError(error: unknown): string {
  if (error instanceof ApiFailure) {
    const code = (error.payload as { error?: string } | null)?.error;
    if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
    switch (error.status) {
      case 401:
        return "انتهت الجلسة أو أن البيانات غير صحيحة. سجّل الدخول من جديد.";
      case 403:
        return "ليست لديك صلاحية لهذا الإجراء.";
      case 409:
        return "حدث تعارض: عُدّل المحتوى من مكان آخر. حدّث الصفحة وحاول مرة أخرى.";
      case 413:
        return "الملف كبير جدًا (الحد ٥ ميجابايت).";
      case 422:
        return "راجع البيانات المدخلة.";
      case 428:
        return "أكمل بيانات حسابك أولًا.";
      default:
        return "تعذّر تنفيذ العملية. حاول مرة أخرى.";
    }
  }
  if (error instanceof TypeError)
    return "تعذّر الاتصال بالسيرفر. تحقق من الشبكة.";
  return "حدث خطأ غير متوقع.";
}

export const fieldErrorsOf = (error: unknown): Record<string, string> => {
  if (error instanceof ApiFailure && error.status === 422) {
    const details = (
      error.payload as { details?: Record<string, string[]> } | null
    )?.details;
    if (details) {
      const flat: Record<string, string> = {};
      for (const [key, messages] of Object.entries(details)) {
        if (messages?.length) flat[key] = messages[0];
      }
      return flat;
    }
  }
  return {};
};

/* -------------------------------------------------------------- image field */

export function ImagePreview({ url, alt }: { url: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  if (!url || broken) {
    return (
      <div className="image-preview image-preview--empty">
        <Icons.imageOff size={26} />
        <span>{url ? "تعذّر تحميل الصورة" : "لا توجد صورة"}</span>
      </div>
    );
  }
  return (
    <div className="image-preview">
      <img src={url} alt={alt} loading="lazy" onError={() => setBroken(true)} />
    </div>
  );
}

/**
 * Image field used by products, events and site branding: accepts an absolute
 * URL, a same-origin path, or a file uploaded from the device.
 */
export function ImageField({
  label,
  value,
  webpValue,
  onChange,
  onWebpChange,
  hint,
  labelExtra,
}: {
  label: string;
  value: string;
  webpValue?: string;
  onChange: (value: string) => void;
  onWebpChange?: (value: string) => void;
  hint?: string;
  labelExtra?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const result: { upload: StoredUpload } = await adminApi.upload(file);
      onChange(result.upload.url);
      if (onWebpChange && result.upload.mime === "image/webp")
        onWebpChange(result.upload.url);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="image-field">
      <div className="image-field-top">
        <ImagePreview url={value} alt={label} />
        <div className="image-field-controls">
          <Field label={label} hint={hint} error={error}>
            <TextInput
              value={value}
              onChange={onChange}
              dir="ltr"
              placeholder="https://… أو /uploads/…"
            />
          </Field>
          {onWebpChange && (
            <Field label="رابط WebP (اختياري)">
              <TextInput
                value={webpValue ?? ""}
                onChange={onWebpChange}
                dir="ltr"
                placeholder="https://… .webp"
              />
            </Field>
          )}
          <div className="image-field-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="visually-hidden"
              aria-label={`رفع ${label} من الجهاز`}
              id={`upload-${label.replace(/[^\p{L}\p{N}]+/gu, "-")}`}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              variant="soft"
              size="sm"
              icon={<Icons.upload size={16} />}
              loading={busy}
              onClick={() => fileRef.current?.click()}
            >
              رفع صورة من الجهاز
            </Button>
            {value && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Icons.trash size={15} />}
                onClick={() => onChange("")}
              >
                إزالة
              </Button>
            )}
            {labelExtra}
          </div>
          <p className="field-hint">
            الصيغ المدعومة: PNG، JPG، JPEG، GIF، WebP — بحد أقصى ٥ ميجابايت.
          </p>
        </div>
      </div>
    </div>
  );
}
