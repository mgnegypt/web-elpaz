import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LOGO_URL, SITE } from "../data";
export function BrandLogo({ large = false }: { large?: boolean }) {
  return LOGO_URL ? (
    <img
      src={LOGO_URL}
      alt={SITE.name}
      width={large ? 200 : 52}
      height={large ? 200 : 52}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <span className={`brand-mark ${large ? "brand-mark-large" : ""}`}>
      إلباظ<span>خير الطبيعة</span>
    </span>
  );
}
export function WhatsAppIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.52 3.48A11.86 11.86 0 0012.06 0C5.47 0 .1 5.36.1 11.95c0 2.1.55 4.15 1.6 5.96L0 24l6.25-1.64a11.9 11.9 0 005.8 1.48h.01C18.65 23.84 24 18.48 24 11.9c0-3.18-1.24-6.17-3.48-8.42zM12.06 21.8a9.9 9.9 0 01-5.04-1.38l-.36-.21-3.71.97.99-3.62-.24-.37a9.86 9.86 0 01-1.51-5.24c0-5.48 4.46-9.94 9.95-9.94a9.86 9.86 0 017.02 2.91 9.86 9.86 0 012.9 7.02c0 5.49-4.46 9.86-10 9.86zm5.45-7.4c-.3-.15-1.77-.88-2.04-.98-.28-.1-.48-.15-.68.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.88-.79-1.48-1.77-1.65-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.68-1.62-.93-2.22-.24-.58-.49-.5-.68-.51h-.57c-.2 0-.52.08-.79.38-.27.3-1.04 1.02-1.04 2.49s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.1 4.48.71.3 1.27.48 1.7.61.72.23 1.36.2 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35z" />
    </svg>
  );
}
export function ProductImage({
  src,
  webp = "",
  fallback,
  alt,
  hero = false,
  active = false,
  style,
  className = "",
}: {
  src: string;
  webp?: string;
  fallback: string;
  alt: string;
  hero?: boolean;
  active?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (imageRef.current && !imageRef.current.complete) setFailed(true);
    }, 6000);
    return () => clearTimeout(timeout);
  }, [src]);
  return (
    <picture className={className} style={style}>
      {webp && !failed && <source srcSet={webp} type="image/webp" />}
      <img
        ref={imageRef}
        src={failed ? fallback : src}
        alt={alt}
        width="600"
        height="850"
        draggable={false}
        loading={hero ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={active ? "high" : "auto"}
        onError={() => setFailed(true)}
      />
    </picture>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="section-title">
      <span className="eyebrow">
        <span />
        {eyebrow}
        <span />
      </span>
      <h1>{title}</h1>
      <svg
        className="title-wave"
        width="66"
        height="10"
        viewBox="0 0 66 10"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M1 5Q9 -2 17 5T33 5T49 5T65 5"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
      {subtitle && <p>{subtitle}</p>}
    </header>
  );
}
export function BrandSocial({ type }: { type: "facebook" | "instagram" }) {
  return (
    <svg
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      {type === "facebook" ? (
        <path d="M13.5 22v-9h3l.5-3.5h-3.5V7.3c0-1 .3-1.8 1.8-1.8H17V2.4c-.3 0-1.4-.2-2.7-.2-2.8 0-4.8 1.7-4.8 4.8v2.5h-3V13h3v9z" />
      ) : (
        <>
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle
            cx="12"
            cy="12"
            r="4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="17.5" cy="6.5" r="1.2" />
        </>
      )}
    </svg>
  );
}
