// Navigation inside a page: tabs, segmented filters, pagination, table shells
// and the sticky save bar. Each one is keyboard-operable and RTL-aware.
import { useRef, type ReactNode } from "react";
import { Icons } from "../icons";
import { Button } from "./primitives";

export type TabItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  badge?: number | string;
};

/**
 * Tab strip with arrow-key navigation. The strip scrolls horizontally on
 * narrow screens (an intentional, contained scroll — never the whole page).
 */
export function Tabs({
  items,
  value,
  onChange,
  label,
  variant = "line",
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  label: string;
  variant?: "line" | "pill";
}) {
  const strip = useRef<HTMLDivElement>(null);

  const move = (delta: number) => {
    const index = items.findIndex((item) => item.key === value);
    const next = items[(index + delta + items.length) % items.length];
    if (!next) return;
    onChange(next.key);
    requestAnimationFrame(() => {
      strip.current
        ?.querySelector<HTMLElement>(`[data-tab="${next.key}"]`)
        ?.focus();
    });
  };

  return (
    <div
      ref={strip}
      className={`tabs tabs--${variant}`}
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        // Right/left are mirrored in RTL: "next" follows reading order.
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        }
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            data-tab={item.key}
            id={`tab-${item.key}`}
            aria-selected={active}
            aria-controls={`panel-${item.key}`}
            tabIndex={active ? 0 : -1}
            className={`tab${active ? " tab--active" : ""}`}
            onClick={() => onChange(item.key)}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge !== undefined && item.badge !== 0 && (
              <span className="tab-badge">{item.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  tabKey,
  active,
  children,
}: {
  tabKey: string;
  active: boolean;
  children: ReactNode;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`panel-${tabKey}`}
      aria-labelledby={`tab-${tabKey}`}
      className="tab-panel"
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

/** Compact filter switcher (status filters, view modes). */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number; icon?: ReactNode }[];
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={`segmented segmented--${size}`}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={`segmented-item${active ? " is-active" : ""}`}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            <span>{option.label}</span>
            {option.count !== undefined && option.count > 0 && (
              <span className="segmented-count">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  onChange,
  summary,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  summary?: string;
}) {
  if (pageCount <= 1) return summary ? <p className="pager-summary">{summary}</p> : null;
  return (
    <nav className="pager" aria-label="تنقل بين الصفحات">
      {summary && <p className="pager-summary">{summary}</p>}
      <div className="pager-controls">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          icon={<Icons.chevronRight size={16} />}
        >
          السابق
        </Button>
        <span className="pager-state" dir="rtl">
          صفحة {page} من {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
          trailingIcon={<Icons.chevronLeft size={16} />}
        >
          التالي
        </Button>
      </div>
    </nav>
  );
}

/**
 * Horizontal scroll container for wide tables. The scroll is confined here so
 * the page itself never scrolls sideways.
 */
export function TableWrap({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

/** Save bar pinned to the bottom of a long editor. */
export function StickySaveBar({
  dirty,
  saving,
  onSave,
  onReset,
  saveLabel = "حفظ ونشر",
  status,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset?: () => void;
  saveLabel?: string;
  status?: ReactNode;
}) {
  return (
    <div className={`save-bar${dirty ? " save-bar--dirty" : ""}`}>
      <div className="save-bar-state">
        <span className="save-bar-dot" aria-hidden="true" />
        <span>
          {saving
            ? "جارٍ الحفظ…"
            : dirty
              ? "لديك تعديلات لم تُنشر بعد"
              : "كل التعديلات منشورة"}
        </span>
        {status}
      </div>
      <div className="save-bar-actions">
        {onReset && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={!dirty || saving}
            icon={<Icons.undo size={15} />}
          >
            تراجع عن التعديلات
          </Button>
        )}
        <Button
          onClick={onSave}
          loading={saving}
          disabled={!dirty}
          icon={<Icons.save size={16} />}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
