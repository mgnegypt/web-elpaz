import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, X } from "lucide-react";
import { useContent } from "../content/ContentContext";
import { useDialog } from "../hooks/useDialog";
export default function Lightbox({
  initial,
  onClose,
}: {
  initial: number;
  onClose: () => void;
}) {
  const { gallery } = useContent();
  const [index, setIndex] = useState(initial),
    ref = useDialog(onClose),
    start = useRef({ x: 0, y: 0 });
  const move = useCallback(
    (d: number) =>
      setIndex((i) => (i + d + gallery.length) % Math.max(1, gallery.length)),
    [gallery.length],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [move]);
  const photo = gallery[index] ?? gallery[0];
  if (!photo) return null;
  return (
    <div
      className="lightbox"
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="معرض الصور"
      tabIndex={-1}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        className="lightbox-close round-button"
        onClick={onClose}
        aria-label="إغلاق معرض الصور"
      >
        <X />
      </button>
      <div
        className="lightbox-image"
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          const dx = e.clientX - start.current.x,
            dy = e.clientY - start.current.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy))
            move(dx < 0 ? 1 : -1);
        }}
      >
        {photo.src ? (
          <img
            src={photo.src}
            alt={photo.caption}
            width="1200"
            height="900"
            decoding="async"
          />
        ) : (
          <div className="gallery-placeholder">
            <span className="placeholder-monogram">إلباظ</span>
            <Camera size={64} strokeWidth={1} />
            <p>صور {photo.caption} قريبًا</p>
          </div>
        )}
      </div>
      <div className="lightbox-caption">
        <button
          className="round-button"
          onClick={() => move(-1)}
          aria-label="الصورة السابقة"
        >
          <ArrowRight />
        </button>
        <div aria-live="polite">
          <h2>{photo.caption}</h2>
          <span dir="ltr">
            {index + 1} / {gallery.length}
          </span>
        </div>
        <button
          className="round-button"
          onClick={() => move(1)}
          aria-label="الصورة التالية"
        >
          <ArrowLeft />
        </button>
      </div>
    </div>
  );
}
