import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="admin-field">
      <span>
        {label}
        {hint && <small> {hint}</small>}
      </span>
      {children}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  dir,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  dir?: "ltr" | "rtl";
  placeholder?: string;
  testId?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        data-testid={testId}
        dir={dir}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  rows = 3,
  hint,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
  testId?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        data-testid={testId}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 100000,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        dir="ltr"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

/** Reorder / add / remove controls shared by every collection editor. */
export function RowTools({
  index,
  total,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="admin-row-tools">
      <button
        type="button"
        className="admin-icon"
        aria-label="تحريك لأعلى"
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUp size={15} />
      </button>
      <button
        type="button"
        className="admin-icon"
        aria-label="تحريك لأسفل"
        disabled={index === total - 1}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDown size={15} />
      </button>
      <button
        type="button"
        className="admin-icon danger"
        aria-label="حذف العنصر"
        onClick={onRemove}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="admin-add" onClick={onClick}>
      <Plus size={16} />
      {label}
    </button>
  );
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
