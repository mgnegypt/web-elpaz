// Layout and display primitives: buttons, badges, cards, page headers, grids,
// toolbars and metric tiles. Every dashboard screen is assembled from these, so
// spacing, radii, focus rings and motion stay identical everywhere.
import type { ReactNode } from "react";
import { Icons } from "../icons";

/* ------------------------------------------------------------------ buttons */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "soft"
  | "ghost"
  | "outline"
  | "danger"
  | "danger-soft";

type ButtonProps = {
  children?: ReactNode;
  variant?: ButtonVariant;
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
  id?: string;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "data-testid"?: string;
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
  id,
  "aria-label": ariaLabel,
  "aria-expanded": ariaExpanded,
  "aria-controls": ariaControls,
  "data-testid": testId,
}: ButtonProps) {
  return (
    <button
      id={id}
      type={type}
      className={`btn btn--${variant} btn--${size}${block ? " btn--block" : ""}${
        className ? ` ${className}` : ""
      }`}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-busy={loading || undefined}
      data-testid={testId}
    >
      {loading ? (
        <Icons.loader size={size === "sm" ? 15 : 17} className="spin" />
      ) : (
        icon
      )}
      {children && <span className="btn-label">{children}</span>}
      {trailingIcon}
    </button>
  );
}

/** Icon-only control. The label is mandatory: it becomes the accessible name. */
export function IconButton({
  label,
  icon,
  onClick,
  variant = "ghost",
  disabled,
  size = "md",
  className = "",
  active,
  type = "button",
  "aria-expanded": ariaExpanded,
  "aria-controls": ariaControls,
}: {
  label: string;
  icon: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: "ghost" | "soft" | "outline" | "danger";
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  active?: boolean;
  type?: "button" | "submit";
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  return (
    <button
      type={type}
      className={`icon-btn icon-btn--${variant} icon-btn--${size}${
        active ? " is-active" : ""
      }${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      title={label}
    >
      {icon}
    </button>
  );
}

/* ------------------------------------------------------------------- badges */

export type BadgeTone =
  | "neutral"
  | "green"
  | "red"
  | "amber"
  | "blue"
  | "violet";

export function Badge({
  children,
  tone = "neutral",
  icon,
  size = "md",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <span className={`badge badge--${tone} badge--${size}`}>
      {icon}
      <span>{children}</span>
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
      <span className="status-dot-mark" aria-hidden="true" />
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------- cards */

export function Card({
  title,
  description,
  icon,
  actions,
  footer,
  children,
  className = "",
  padded = true,
  as: Tag = "section",
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={`card${className ? ` ${className}` : ""}`}>
      {(title || actions) && (
        <header className="card-head">
          <div className="card-heading">
            {icon && <span className="card-icon">{icon}</span>}
            <div className="card-heading-text">
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
      {footer && <footer className="card-foot">{footer}</footer>}
    </Tag>
  );
}

/** Page title block. Sits at the top of every panel, above the content. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
        {meta && <div className="page-meta">{meta}</div>}
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
  columns?: 1 | 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`ui-grid ui-grid--${columns}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}

/** Search + filter row used above lists and tables. */
export function Toolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`toolbar${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

/** A single headline number. Keeps the `.stat-pill` hook the suites rely on. */
export function StatPill({
  label,
  value,
  tone = "blue",
  icon,
  hint,
  onClick,
}: {
  label: string;
  value: number | string;
  tone?: "blue" | "green" | "red" | "amber" | "violet" | "neutral";
  icon?: ReactNode;
  hint?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="stat-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="stat-text">
        <strong>{value}</strong>
        <small>{label}</small>
        {hint && <em>{hint}</em>}
      </span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={`stat-pill stat-pill--${tone} stat-pill--action`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return <div className={`stat-pill stat-pill--${tone}`}>{content}</div>;
}

/** Key/value line used inside summary cards. */
export function MetaRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="meta-row">
      <span className="meta-row-label">{label}</span>
      <span className="meta-row-value">{children}</span>
    </div>
  );
}

/** Non-blocking inline message (info / warning / danger). */
export function Notice({
  tone = "info",
  icon,
  title,
  children,
  action,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const fallback =
    tone === "warn" ? (
      <Icons.alert size={18} />
    ) : tone === "danger" ? (
      <Icons.error size={18} />
    ) : tone === "success" ? (
      <Icons.checkCircle size={18} />
    ) : (
      <Icons.info size={18} />
    );
  return (
    <div
      className={`notice notice--${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <span className="notice-icon">{icon ?? fallback}</span>
      <div className="notice-text">
        {title && <strong>{title}</strong>}
        {children && <p>{children}</p>}
      </div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}
