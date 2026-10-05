import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Leaf, Sparkles } from "lucide-react";
import { COPY, IMAGES } from "../data";
import { ProductImage } from "./shared";
export default function Hero({
  active,
  goTo,
  blocked,
}: {
  active: boolean;
  goTo: (n: number) => void;
  blocked: boolean;
}) {
  const [index, setIndex] = useState(0),
    [animating, setAnimating] = useState(false);
  const lock = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    pointer = useRef<{ x: number; y: number } | null>(null);
  const navigate = useCallback(
    (direction: "next" | "prev") => {
      if (lock.current || blocked) return;
      lock.current = true;
      setAnimating(true);
      setIndex((i) => (i + (direction === "next" ? 1 : 3)) % 4);
      timer.current = setTimeout(() => {
        lock.current = false;
        setAnimating(false);
      }, 650);
    },
    [blocked],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !active ||
        blocked ||
        (e.target instanceof Element &&
          e.target.closest("input,textarea,select,button,a"))
      )
        return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate("prev");
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        navigate("next");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, blocked, navigate]);
  const current = IMAGES[index];
  return (
    <div
      className={`hero ${animating ? "is-animating" : ""}`}
      style={
        {
          backgroundColor: current.bg,
          "--panel": current.panel,
        } as React.CSSProperties
      }
    >
      <div className="hero-halo" />
      <div className="grain" />
      <div className="hero-topline">
        <span>
          <i />
          {COPY.heroEyebrow}
        </span>
        <span dir="ltr">ELBAZ · NATURAL GOODNESS</span>
      </div>
      <div className="hero-ghost" aria-hidden="true">
        إلباظ
      </div>
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="hero-seal">
        <Leaf size={23} strokeWidth={1.4} />
        <span>خير طبيعي</span>
        <small>في كل عبوة</small>
        <Sparkles className="seal-spark" size={16} />
      </div>
      <div className="hero-side-note">
        <span>الأصل في الطعم</span>
        <span className="note-line" />
        <small>{COPY.heroTagline}</small>
      </div>
      <div
        className="hero-carousel"
        dir="ltr"
        aria-roledescription="عرض منتجات"
        aria-label="منتجات البان إلباظ"
        onPointerDown={(e) => {
          if ((e.target as Element).closest("button,a")) return;
          pointer.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          if (!pointer.current) return;
          const dx = e.clientX - pointer.current.x,
            dy = e.clientY - pointer.current.y;
          pointer.current = null;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy))
            navigate(dx > 0 ? "prev" : "next");
        }}
        onPointerCancel={() => {
          pointer.current = null;
        }}
      >
        {IMAGES.map((item, i) => {
          const role =
            i === index
              ? "center"
              : i === (index + 3) % 4
                ? "left"
                : i === (index + 1) % 4
                  ? "right"
                  : "back";
          return (
            <div className={`hero-product role-${role}`} key={item.src}>
              <ProductImage
                src={item.src}
                webp={item.webp}
                fallback={item.fallback}
                alt={item.name}
                hero
                active={role === "center"}
              />
            </div>
          );
        })}
      </div>
      <div className="hero-info">
        <span className="product-kicker">اختيارك للطعم الأصيل</span>
        <div key={index} className="hero-copy">
          <h1>{current.name}</h1>
          <p>{current.desc}</p>
        </div>
        <div className="hero-controls" dir="ltr">
          <button
            className="round-button"
            onClick={() => navigate("prev")}
            aria-label="المنتج السابق"
          >
            <ArrowLeft size={25} />
          </button>
          <button
            className="round-button"
            onClick={() => navigate("next")}
            aria-label="المنتج التالي"
          >
            <ArrowRight size={25} />
          </button>
          <span className="carousel-position">
            <b>0{index + 1}</b>
            <span>/ 04</span>
          </span>
        </div>
      </div>
      <button
        className="hero-explore"
        onClick={() => goTo(1)}
        aria-label="انتقل إلى المنتجات"
      >
        <span className="explore-overline">اكتشف خير الطبيعة</span>
        <span className="explore-main">تصفح المنتجات</span>
        <span className="round-button">
          <ArrowDown className="bounce" size={26} />
        </span>
      </button>
      <div className="hero-bottom">
        <span>{COPY.heroSeal}</span>
        <div className="hero-pagination" dir="ltr">
          {IMAGES.map((item, i) => (
            <button
              key={i}
              aria-label={`عرض ${item.name}`}
              aria-current={index === i ? "true" : undefined}
              className={i === index ? "selected" : ""}
              onClick={() => {
                if (lock.current || blocked || index === i) return;
                lock.current = true;
                setAnimating(true);
                setIndex(i);
                timer.current = setTimeout(() => {
                  lock.current = false;
                  setAnimating(false);
                }, 650);
              }}
            />
          ))}
        </div>
        <span>ألبان · أجبان · خيرات طبيعية</span>
      </div>
    </div>
  );
}
