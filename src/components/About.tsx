import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { CONTENT_STATUS, COPY, SITE, STATS } from "../data";
import { BrandLogo } from "./shared";
import { useReducedMotion } from "../hooks/useReducedMotion";
export default function About({ active }: { active: boolean }) {
  const [progress, setProgress] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1800);
      setProgress(1 - Math.pow(1 - p, 3));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    if (!reduced) {
      setProgress(0);
      frame = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(frame);
  }, [active, reduced]);
  return (
    <div className="about-container section-container centered-section">
      <div className="about-logo enter">
        <BrandLogo large />
      </div>
      <span className="eyebrow">من أرضنا… لبيتك</span>
      <h1>{SITE.name}</h1>
      <h2>{COPY.aboutTagline}</h2>
      <p className="about-description">{COPY.aboutDescription}</p>
      <div className="about-chips">
        {COPY.aboutChips.map((chip) => (
          <span key={chip}>
            <Check size={16} />
            {chip}
          </span>
        ))}
      </div>
      <div className="stats-grid grid grid-cols-2 sm:grid-cols-4">
        {STATS.map((s) => (
          <div className="stat" key={s.label}>
            <strong dir="ltr">
              {Math.round(s.value * (reduced ? 1 : progress))}
              {s.suffix}
            </strong>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
      {CONTENT_STATUS.statsArePlaceholders && (
        <small className="placeholder-note">
          أرقام توضيحية قيد التحديث والتأكيد.
        </small>
      )}
    </div>
  );
}
