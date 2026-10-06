import { useEffect, useState } from "react";
import { useContent } from "../content/ContentContext";
import { BrandLogo } from "./shared";
import MilkWave from "./MilkWave";
import { useReducedMotion } from "../hooks/useReducedMotion";
export default function Loader({ onDone }: { onDone: () => void }) {
  const { hero } = useContent();
  const slides = hero.slides;
  const [progress, setProgress] = useState(0),
    [exit, setExit] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    let live = true,
      count = 0,
      ready = false,
      min = false;
    const total = slides.length + 1; // slides + fonts
    const images: HTMLImageElement[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = () => {
      if (!live || ready || !min) return;
      ready = true;
      setProgress(100);
      setExit(true);
      timers.push(setTimeout(onDone, reduced ? 300 : 1100));
    };
    const loaded = () => {
      count++;
      if (live) setProgress((count / total) * 100);
      if (count >= total) finish();
    };
    slides.forEach((item) => {
      const image = new Image();
      images.push(image);
      image.onload = loaded;
      image.onerror = loaded;
      image.src = item.webp || item.src;
      const fallback = new Image();
      fallback.src = item.fallback;
      images.push(fallback);
    });
    document.fonts.ready.then(loaded, loaded);
    timers.push(
      setTimeout(() => {
        min = true;
        if (count >= total) finish();
      }, 1400),
    );
    timers.push(
      setTimeout(() => {
        min = true;
        finish();
      }, 6000),
    );
    return () => {
      live = false;
      timers.forEach(clearTimeout);
      images.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
    };
  }, [onDone, reduced, slides]);
  return (
    <div
      className={`loader ${exit ? "loader-exit" : ""}`}
      role="status"
      aria-label="جاري تحميل الموقع"
    >
      <div className="loader-content">
        <div className="loader-logo">
          <BrandLogo large />
          <div
            className="milk-fill"
            style={{ transform: `translateY(${100 - progress}%)` }}
          >
            <svg viewBox="0 0 200 30">
              <path
                d="M0 15 Q25 0 50 15 T100 15 T150 15 T200 15V30H0Z"
                fill="white"
              />
            </svg>
          </div>
        </div>
        <p>جاري التحميل...</p>
        <span className="loader-percent" dir="ltr">
          {Math.round(progress)}%
        </span>
      </div>
      {exit && <MilkWave loader />}
    </div>
  );
}
