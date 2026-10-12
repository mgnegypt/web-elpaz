// Form controls. Everything an administrator types, picks or toggles lives
// here: one label style, one hint style, one error style, one focus ring.
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  CONTENT_ICONS,
  resolveContentIcon,
  type ContentIcon,
} from "../../lib/contentIcons";
import {
  RATING_MAX,
  RATING_MIN,
  RATING_PRECISION_STEP,
  RATING_STEP,
  clampRating,
} from "../../../shared/content.ts";
import { adminApi, type StoredUpload } from "../api";
import { Icons } from "../icons";
import { Button, IconButton } from "./primitives";
import { describeError } from "./feedback";

/* ------------------------------------------------------------------- field */

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
  labelAction,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  /** Small control shown at the end of the label row (e.g. a counter). */
  labelAction?: ReactNode;
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
  const requiredMark = required ? (
    <span className="field-req" aria-hidden="true">
      *
    </span>
  ) : null;
  return (
    <div
      className={`field${error ? " field--invalid" : ""}${className ? ` ${className}` : ""}`}
    >
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
          {labelAction && <span className="field-label-end">{labelAction}</span>}
        </span>
      )}
      {control}
      {error ? (
        <p className="field-error" role="alert">
          <Icons.error size={14} />
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}

/** Group of related fields inside a card, with its own caption. */
export function FormSection({
  title,
  description,
  icon,
  children,
  actions,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="form-section">
      {(title || actions) && (
        <header className="form-section-head">
          <div className="form-section-title">
            {icon && <span className="form-section-icon">{icon}</span>}
            <div>
              {title && <h3>{title}</h3>}
              {description && <p>{description}</p>}
            </div>
          </div>
          {actions}
        </header>
      )}
      <div className="form-section-body">{children}</div>
    </section>
  );
}

/** Progressive disclosure for the few technical fields that must stay. */
export function Disclosure({
  label = "خيارات متقدمة",
  hint,
  children,
  defaultOpen = false,
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={`disclosure${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="disclosure-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Icons.chevronDown size={16} className="disclosure-caret" />
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </button>
      {open && (
        <div className="disclosure-body" id={id}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ inputs */

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
  inputMode,
  min,
  max,
  step,
  testId,
  autoFocus,
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
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "url";
  min?: number | string;
  max?: number | string;
  step?: number | string;
  testId?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      id={id}
      data-testid={testId}
      className={`input${invalid ? " input--invalid" : ""}`}
      value={value}
      type={type}
      dir={dir}
      inputMode={inputMode}
      placeholder={placeholder}
      autoComplete={autoComplete}
      disabled={disabled}
      maxLength={maxLength}
      min={min}
      max={max}
      step={step}
      onBlur={onBlur}
      required={required}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Password with a show/hide control that never traps the keyboard. */
export function PasswordInput({
  value,
  onChange,
  id,
  autoComplete = "current-password",
  placeholder,
  disabled,
  required,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={`input-affix${invalid ? " input-affix--invalid" : ""}`}>
      <input
        id={id}
        className="input input--affixed"
        type={visible ? "text" : "password"}
        dir="ltr"
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="input-affix-btn"
        onClick={() => setVisible((shown) => !shown)}
        aria-pressed={visible}
        aria-label={visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
        title={visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
        disabled={disabled}
      >
        {visible ? <Icons.eyeOff size={17} /> : <Icons.eye size={17} />}
      </button>
    </div>
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
  invalid,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  id?: string;
  maxLength?: number;
  required?: boolean;
  invalid?: boolean;
  testId?: string;
}) {
  return (
    <textarea
      id={id}
      data-testid={testId}
      required={required}
      className={`input textarea${invalid ? " input--invalid" : ""}`}
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
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="select-wrap">
      <select
        id={id}
        required={required}
        aria-label={ariaLabel}
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

/** Search box with a visible clear control (never hover-only). */
export function SearchInput({
  value,
  onChange,
  placeholder = "ابحث…",
  label,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  id?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className="search-box">
      <Icons.search size={16} className="search-icon" />
      <input
        id={inputId}
        className="input input--search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        type="search"
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label="مسح البحث"
          onClick={() => onChange("")}
        >
          <Icons.close size={15} />
        </button>
      )}
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
  id,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint?: string; icon?: ReactNode }[];
  columns?: 1 | 2;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`option-group option-group--${columns}`}
      role="radiogroup"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`option${value === option.value ? " option--active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.icon && (
            <span className="option-icon" aria-hidden="true">
              {option.icon}
            </span>
          )}
          <span className="option-text">
            <strong>{option.label}</strong>
            {option.hint && <small>{option.hint}</small>}
          </span>
          <span className="option-check" aria-hidden="true">
            {value === option.value && <Icons.check size={15} />}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Colour picker + hex value, labelled for screen readers. */
export function ColorField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className="field-label-row">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      </span>
      <div className="color-row">
        <input
          id={id}
          type="color"
          className="color-swatch"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          className="input"
          dir="ltr"
          value={value}
          aria-label={`${label} (قيمة اللون)`}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

/* ----------------------------------------------------------- star rating */

const formatRating = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

/**
 * Visual 1–5 rating with decimals.
 *
 * Tap a star to choose it, tap the same star again for the half value (4 → 3.5),
 * or type an exact value such as 4.8. Values outside 1–5 are refused by the same
 * rule the API applies, so what the operator sees is what gets stored.
 */
export function StarRating({
  value,
  onChange,
  label = "التقييم",
  hint,
  error,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  hint?: ReactNode;
  error?: string;
}) {
  const labelId = useId();
  const inputId = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const safe = Number.isFinite(value) ? value : RATING_MIN;

  const pick = (star: number) => {
    // Tapping the active star again selects its half value (4 → 3.5).
    const next =
      Math.abs(safe - star) < 0.001 ? Math.max(RATING_MIN, star - 0.5) : star;
    setTyped(null);
    onChange(clampRating(next));
  };

  const nudge = (delta: number) => {
    setTyped(null);
    onChange(clampRating(safe + delta));
  };

  return (
    <div className={`field rating-field${error ? " field--invalid" : ""}`}>
      <span className="field-label-row">
        <span className="field-label" id={labelId}>
          {label}
        </span>
      </span>
      <div className="rating-row">
        <div
          className="rating-stars"
          role="group"
          aria-labelledby={labelId}
          dir="ltr"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowUp") {
              event.preventDefault();
              nudge(RATING_STEP);
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
              event.preventDefault();
              nudge(-RATING_STEP);
            }
          }}
        >
          {[1, 2, 3, 4, 5].map((star) => {
            const fill = Math.min(1, Math.max(0, safe - (star - 1)));
            return (
              <button
                key={star}
                type="button"
                className="rating-star"
                aria-label={`${star} من ${RATING_MAX}`}
                aria-pressed={safe >= star - 0.25}
                onClick={() => pick(star)}
              >
                <span className="rating-star-art" aria-hidden="true">
                  <Icons.star size={22} className="rating-star-base" />
                  {fill > 0 && (
                    <span
                      className="rating-star-fill"
                      style={{ width: `${fill * 100}%` }}
                    >
                      <Icons.star size={22} />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <output className="rating-value" dir="ltr" aria-live="polite">
          {formatRating(safe)} / {RATING_MAX}
        </output>
        <div className="rating-exact">
          <label className="rating-exact-label" htmlFor={inputId}>
            قيمة دقيقة
          </label>
          <input
            id={inputId}
            className="input rating-input"
            type="number"
            dir="ltr"
            inputMode="decimal"
            min={RATING_MIN}
            max={RATING_MAX}
            step={RATING_PRECISION_STEP}
            value={typed ?? formatRating(safe)}
            onChange={(event) => {
              const raw = event.target.value;
              setTyped(raw);
              const parsed = Number(raw);
              if (raw.trim() !== "" && Number.isFinite(parsed))
                onChange(clampRating(parsed));
            }}
            onBlur={() => setTyped(null)}
          />
        </div>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          <Icons.error size={14} />
          {error}
        </p>
      ) : (
        <p className="field-hint">
          {hint ??
            "اضغط على النجمة لاختيار التقييم، واضغط عليها مرة أخرى لاختيار النصف (مثل ٤٫٥)، أو اكتب قيمة دقيقة بين ١ و٥."}
        </p>
      )}
    </div>
  );
}

/** Read-only stars used in lists and previews. */
export function StarsDisplay({
  value,
  size = 15,
}: {
  value: number;
  size?: number;
}) {
  const safe = Number.isFinite(value) ? value : 0;
  return (
    <span className="stars-display" dir="ltr" aria-label={`${safe} من 5`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = Math.min(1, Math.max(0, safe - (star - 1)));
        return (
          <span className="rating-star-art" key={star} aria-hidden="true">
            <Icons.star size={size} className="rating-star-base" />
            {fill > 0 && (
              <span
                className="rating-star-fill"
                style={{ width: `${fill * 100}%` }}
              >
                <Icons.star size={size} />
              </span>
            )}
          </span>
        );
      })}
      <small>{formatRating(safe)}</small>
    </span>
  );
}

/* ------------------------------------------------------------- icon picker */

/**
 * Visual icon chooser. Administrators see the icon and an Arabic label; the
 * document stores a short stable key (`leaf`, `delivery`…). Icon component
 * names are never shown anywhere in the interface.
 */
export function IconPicker({
  value,
  onChange,
  label = "الأيقونة",
  hint = "اختر الأيقونة التي تظهر بجانب الميزة على الموقع.",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
}) {
  const labelId = useId();
  const current = resolveContentIcon(value);
  return (
    <div className="field icon-picker-field">
      <span className="field-label-row">
        <span className="field-label" id={labelId}>
          {label}
        </span>
        <span className="field-label-end icon-picker-current">
          <current.Icon size={16} aria-hidden="true" strokeWidth={1.8} />
          {current.label}
        </span>
      </span>
      <div className="icon-picker" role="radiogroup" aria-labelledby={labelId}>
        {CONTENT_ICONS.map((icon: ContentIcon) => {
          const active = icon.key === current.key;
          return (
            <button
              key={icon.key}
              type="button"
              role="radio"
              aria-checked={active}
              className={`icon-option${active ? " icon-option--active" : ""}`}
              onClick={() => onChange(icon.key)}
            >
              <span className="icon-option-art" aria-hidden="true">
                <icon.Icon size={20} strokeWidth={1.7} />
              </span>
              <span className="icon-option-label">{icon.label}</span>
            </button>
          );
        })}
      </div>
      <p className="field-hint">{hint}</p>
    </div>
  );
}

/* ------------------------------------------------------------- collections */

/** Move an item inside a list (used by every repeatable content editor). */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** One repeatable row: numbered header, reorder + delete, then the fields. */
export function ItemCard({
  index,
  total,
  title,
  subtitle,
  onMove,
  onRemove,
  children,
  removeLabel = "حذف العنصر",
}: {
  index: number;
  total: number;
  title: ReactNode;
  subtitle?: ReactNode;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  children: ReactNode;
  removeLabel?: string;
}) {
  return (
    <article className="item-card">
      <header className="item-card-head">
        <span className="item-card-index" dir="ltr">
          {index + 1}
        </span>
        <div className="item-card-title">
          <strong>{title}</strong>
          {subtitle && <small>{subtitle}</small>}
        </div>
        <div className="item-card-tools">
          <IconButton
            label="تحريك لأعلى"
            size="sm"
            icon={<Icons.arrowUp size={15} />}
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
          />
          <IconButton
            label="تحريك لأسفل"
            size="sm"
            icon={<Icons.arrowDown size={15} />}
            disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}
          />
          <IconButton
            label={removeLabel}
            size="sm"
            variant="danger"
            icon={<Icons.trash size={15} />}
            onClick={onRemove}
          />
        </div>
      </header>
      <div className="item-card-body">{children}</div>
    </article>
  );
}

/** Single-line repeatable value (category, unit, chip). */
export function InlineListRow({
  index,
  total,
  value,
  onChange,
  onMove,
  onRemove,
  label,
}: {
  index: number;
  total: number;
  value: string;
  onChange: (value: string) => void;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  label: string;
}) {
  return (
    <div className="inline-row">
      <span className="inline-row-index" dir="ltr" aria-hidden="true">
        {index + 1}
      </span>
      <input
        className="input"
        value={value}
        aria-label={`${label} ${index + 1}`}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="inline-row-tools">
        <IconButton
          label={`تحريك ${label} ${index + 1} لأعلى`}
          size="sm"
          icon={<Icons.arrowUp size={15} />}
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        />
        <IconButton
          label={`تحريك ${label} ${index + 1} لأسفل`}
          size="sm"
          icon={<Icons.arrowDown size={15} />}
          disabled={index === total - 1}
          onClick={() => onMove(index, index + 1)}
        />
        <IconButton
          label={`حذف ${label} ${index + 1}`}
          size="sm"
          variant="danger"
          icon={<Icons.trash size={15} />}
          onClick={onRemove}
        />
      </div>
    </div>
  );
}

export function AddItemButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="add-item" onClick={onClick}>
      <Icons.plus size={16} />
      <span>{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------- image field */

/**
 * Image that degrades to a neutral placeholder instead of the browser's broken
 * icon: it tries the main source, then the fallback, then gives up quietly.
 */
export function Thumb({
  src,
  fallback = "",
  alt = "",
  className = "",
}: {
  src: string;
  fallback?: string;
  alt?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => setFailed([]), [src, fallback]);
  const candidate = [src, fallback].find((url) => url && !failed.includes(url));
  if (!candidate)
    return (
      <span className={`thumb thumb--empty ${className}`.trim()}>
        <Icons.imageOff size={20} aria-hidden="true" />
      </span>
    );
  return (
    <img
      className={`thumb ${className}`.trim()}
      src={candidate}
      alt={alt}
      loading="lazy"
      onError={() => setFailed((list) => [...list, candidate])}
    />
  );
}

export function ImagePreview({
  url,
  alt,
  className = "",
}: {
  url: string;
  alt: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  if (!url || broken) {
    return (
      <div
        className={`image-preview image-preview--empty${className ? ` ${className}` : ""}`}
      >
        <Icons.imageOff size={22} />
        <span>{url ? "تعذّر تحميل الصورة" : "لا توجد صورة"}</span>
      </div>
    );
  }
  return (
    <div className={`image-preview${className ? ` ${className}` : ""}`}>
      <img src={url} alt={alt} loading="lazy" onError={() => setBroken(true)} />
    </div>
  );
}

/**
 * Image field used by products, events and site branding.
 *
 * The primary workflow is "upload from this device". Pasting a link and the
 * optional lighter WebP copy live under "خيارات متقدمة" with plain-Arabic
 * explanations, so nobody needs to know what WebP is to add a picture.
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
  const slug = useMemo(
    () => label.replace(/[^\p{L}\p{N}]+/gu, "-"),
    [label],
  );
  // An external link (not an upload) stays visible so nothing looks lost.
  const external = Boolean(value) && !value.startsWith("/uploads/");

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
      <span className="field-label-row">
        <span className="field-label">{label}</span>
        {labelExtra && <span className="field-label-end">{labelExtra}</span>}
      </span>
      <div className="image-field-top">
        <ImagePreview url={value} alt={label} />
        <div className="image-field-controls">
          <div className="image-field-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="visually-hidden"
              aria-label={`رفع ${label} من الجهاز`}
              id={`upload-${slug}`}
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
                إزالة الصورة
              </Button>
            )}
          </div>
          <p className="field-hint">
            {hint ?? "اختر صورة واضحة من جهازك — تظهر على الموقع فورًا بعد الحفظ."}
          </p>
          <p className="field-hint">
            الصيغ المدعومة: PNG، JPG، JPEG، GIF، WebP — بحد أقصى ٥ ميجابايت.
          </p>
          {error && (
            <p className="field-error" role="alert">
              <Icons.error size={14} />
              {error}
            </p>
          )}
          <Disclosure
            label="خيارات متقدمة للصورة"
            hint="رابط خارجي ونسخة أخف"
            defaultOpen={external}
          >
            <Field
              label="رابط الصورة"
              hint="استخدمه إذا كانت الصورة مرفوعة على موقع آخر. يجب أن يبدأ بـ https://"
            >
              <TextInput
                value={value}
                onChange={onChange}
                dir="ltr"
                placeholder="https://…"
              />
            </Field>
            {onWebpChange && (
              <Field
                label="نسخة أخف من الصورة (اختياري)"
                hint="صيغة WebP تجعل الموقع أسرع. اتركها فارغة إذا لم تكن متوفرة."
              >
                <TextInput
                  value={webpValue ?? ""}
                  onChange={onWebpChange}
                  dir="ltr"
                  placeholder="https://… .webp"
                />
              </Field>
            )}
          </Disclosure>
        </div>
      </div>
    </div>
  );
}
