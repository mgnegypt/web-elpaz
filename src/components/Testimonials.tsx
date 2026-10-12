import { useEffect, useRef, useState } from "react";
import { Quote, Star, UserRound } from "lucide-react";
import { reviewIsIllustrative } from "../../shared/content.ts";
import { useContent } from "../content/ContentContext";
import { SectionTitle } from "./shared";
import { useReducedMotion } from "../hooks/useReducedMotion";
export default function Testimonials({ active }: { active: boolean }) {
  const { reviews, copy, contentStatus } = useContent();
  const [index, setIndex] = useState(0),
    [paused, setPaused] = useState(false),
    start = useRef({ x: 0, y: 0 });
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!active || paused || reduced) return;
    const id = setInterval(
      () => setIndex((i) => (i + 1) % Math.max(1, reviews.length)),
      5000,
    );
    return () => clearInterval(id);
  }, [active, paused, reduced, reviews.length]);
  const item = reviews[index] ?? reviews[0];
  if (!item) return null;
  return (
    <div className="section-container centered-section testimonials-container">
      <SectionTitle
        eyebrow="شركاء الحكاية"
        title="آراء عملائنا"
        subtitle={copy.testimonialSubtitle}
      />
      <div
        className="quote-card"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        onPointerDown={(e) => {
          setPaused(true);
          start.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          const dx = e.clientX - start.current.x,
            dy = e.clientY - start.current.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy))
            setIndex(
              (i) =>
                (i + (dx < 0 ? 1 : reviews.length - 1)) %
                Math.max(1, reviews.length),
            );
        }}
      >
        <Quote className="quote-mark" size={52} strokeWidth={1.1} />
        <div className="quote-content enter" key={index}>
          <div className="stars" aria-label={`${item.rating} من 5 نجوم`}>
            {Array.from({ length: 5 }, (_, i) => {
              // Decimal ratings (4.5, 4.8…) fill the matching slice of a star.
              const fill = Math.min(1, Math.max(0, item.rating - i));
              return (
                <span className="star-slot" key={i}>
                  <Star size={19} fill="none" stroke="#D69D23" strokeWidth={1} />
                  {fill > 0 && (
                    <span
                      className="star-fill"
                      style={{ width: `${fill * 100}%` }}
                      aria-hidden="true"
                    >
                      <Star
                        size={19}
                        fill="#FFD86B"
                        stroke="#D69D23"
                        strokeWidth={1}
                      />
                    </span>
                  )}
                </span>
              );
            })}
            <span className="star-value" dir="ltr" aria-hidden="true">
              {item.rating} / 5
            </span>
          </div>
          <blockquote>« {item.text} »</blockquote>
          <div className="review-person">
            <span className="review-avatar">
              <UserRound size={23} />
            </span>
            <div>
              <h2>{item.name}</h2>
              <span>{item.role}</span>
            </div>
          </div>
        </div>
        {reviewIsIllustrative(item, contentStatus) && (
          <span className="review-placeholder">
            رأي توضيحي — في انتظار آراء عملائنا الحقيقية
          </span>
        )}
      </div>
      <div className="review-dots">
        {reviews.map((_, i) => (
          <button
            key={i}
            className={index === i ? "active" : ""}
            aria-label={`رأي العميل ${i + 1}`}
            aria-pressed={index === i}
            onClick={() => {
              setIndex(i);
              setPaused(true);
            }}
          >
            <span />
          </button>
        ))}
      </div>
    </div>
  );
}
