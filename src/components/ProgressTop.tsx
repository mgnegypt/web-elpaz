import { ArrowUp } from "lucide-react";
export default function ProgressTop({
  section,
  onClick,
}: {
  section: number;
  onClick: () => void;
}) {
  if (!section) return null;
  return (
    <button
      className="progress-top"
      aria-label="العودة للأعلى"
      onClick={onClick}
    >
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <circle
          cx="28"
          cy="28"
          r="25"
          fill="#1E3FA8"
          stroke="#4766C8"
          strokeWidth="2"
        />
        <circle
          cx="28"
          cy="28"
          r="25"
          fill="none"
          stroke="white"
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
