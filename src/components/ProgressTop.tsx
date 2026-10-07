import { ArrowUp } from "lucide-react";
export default function ProgressTop({
  section,
  onClick,
  blocked = false,
}: {
  section: number;
  onClick: () => void;
  blocked?: boolean;
}) {
  if (!section) return null;
  return (
    <button
      className="progress-top"
      aria-label="العودة للأعلى"
      onClick={onClick}
      inert={blocked}
    >
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <circle className="progress-disc" cx="28" cy="28" r="25" strokeWidth="2" />
        <circle
          className="progress-arc"
          cx="28"
          cy="28"
          r="25"
          fill="none"
          strokeWidth="2"
          strokeDasharray={`${(section / 7) * 157.08} 157.08`}
          transform="rotate(-90 28 28)"
        />
      </svg>
      <ArrowUp size={20} />
      <span dir="ltr">{section + 1}/8</span>
    </button>
  );
}
