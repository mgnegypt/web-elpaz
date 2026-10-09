import { useEffect, useRef, useState } from "react";
import { useContent } from "../content/ContentContext";
import { BrandLogo } from "./shared";
import MilkWave from "./MilkWave";
import { useReducedMotion } from "../hooks/useReducedMotion";
export default function Loader({
  onDone,
  contentReady = true,
}: {
  onDone: () => void;
  /**
   * False until the first /api/content attempt settles. The splash waits for
   * it (within the existing 6s ceiling) so the site is revealed with the
   * published document rather than the bundled defaults.
   */
  contentReady?: boolean;
}) {
  const { hero } = useContent();
  const slides = hero.slides;
  const [progress, setProgress] = useState(0),
    [exit, setExit] = useState(false);
  const reduced = useReducedMotion();
  const contentReadyRef = useRef(contentReady);
  contentReadyRef.current = contentReady;
  const finishRef = useRef<(force?: boolean) => void>(() => {});
  // Content arriving after the images is the common case: try again then.
  useEffect(() => {
    if (contentReady) finishRef.current();
  }, [contentReady]);
  useEffect(() => {
    let live = true,
      count = 0,
      ready = false,
      min = false;
    const total = slides.length + 1; // slides + fonts
    const images: HTMLImageElement[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (force = false) => {
      if (!live || ready) return;
      // The splash hides when the images are in, the minimum beat has passed
      // and the content request has settled — `force` is the 6s safety net.
      if (!force && (!min || !contentReadyRef.current)) return;
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
        finish(true);
      }, 6000),
    );
    finishRef.current = finish;
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
