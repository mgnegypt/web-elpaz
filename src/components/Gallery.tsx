import { useRef } from "react";
import { Camera, ArrowLeft, ArrowRight, Expand } from "lucide-react";
import { useContent } from "../content/ContentContext";
import { SectionTitle } from "./shared";
export default function Gallery({ onOpen }: { onOpen: (i: number) => void }) {
  const { gallery, copy } = useContent();
  const track = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; left: number; distance: number } | null>(null),
    moved = useRef(false);
  return (
    <div className="section-container centered-section gallery-container">
      <SectionTitle
        eyebrow="من وراء الكواليس"
        title="من مصنعنا ومزارعنا"
        subtitle={copy.gallerySubtitle}
      />
      <div
        ref={track}
        className="gallery-track"
        onPointerDown={(e) => {
          if (e.pointerType === "touch") return;
          drag.current = {
            x: e.clientX,
            left: e.currentTarget.scrollLeft,
            distance: 0,
          };
          moved.current = false;
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x;
          if (Math.abs(dx) > 5) {
            e.currentTarget.setPointerCapture(e.pointerId);
            moved.current = true;
            e.currentTarget.scrollLeft = drag.current.left - dx;
            drag.current.distance = dx;
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
      >
        {gallery.map((photo, i) => (
          <button
            className="gallery-tile"
            key={`${photo.caption}-${i}`}
            onClick={() => {
              if (!moved.current) onOpen(i);
              moved.current = false;
            }}
            aria-label={`تكبير صورة ${photo.caption}`}
          >
            {photo.src ? (
              <img
                src={photo.src}
                alt={photo.caption}
                loading="lazy"
                decoding="async"
                width="600"
                height="450"
                draggable={false}
              />
            ) : (
              <div className="gallery-placeholder">
                <span className="placeholder-monogram" aria-hidden="true">
                  إلباظ
                </span>
                <Camera size={40} strokeWidth={1.2} />
                <span>قريبًا… من قلب الحكاية</span>
              </div>
            )}
            <span className="gallery-caption">
              <span>
                <small dir="ltr">0{i + 1} / 0{gallery.length}</small>
                {photo.caption}
              </span>
              <Expand size={19} />
            </span>
          </button>
        ))}
      </div>
      <div className="gallery-bottom">
        <p>كل خطوة بعناية. كل منتج بحب.</p>
        <div className="gallery-arrows" dir="ltr">
          <button
            className="outline-circle"
            onClick={() =>
              track.current?.scrollBy({ left: -360, behavior: "smooth" })
            }
            aria-label="الصورة التالية"
          >
            <ArrowLeft />
          </button>
          <button
            className="outline-circle"
            onClick={() =>
              track.current?.scrollBy({ left: 360, behavior: "smooth" })
            }
            aria-label="الصورة السابقة"
          >
            <ArrowRight />
          </button>
        </div>
      </div>
    </div>
  );
}
