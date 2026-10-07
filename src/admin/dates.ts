// Date/time helpers for the dashboard welcome bar. Everything is rendered in
// Egypt local time (Africa/Cairo) regardless of where the operator is sitting.

export const EGYPT_TIME_ZONE = "Africa/Cairo";

const safeFormat = (
  options: Intl.DateTimeFormatOptions,
  fallback: Intl.DateTimeFormatOptions,
  date: Date,
) => {
  try {
    return new Intl.DateTimeFormat("ar-EG", { timeZone: EGYPT_TIME_ZONE, ...options }).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat("ar-EG", { timeZone: EGYPT_TIME_ZONE, ...fallback }).format(
        date,
      );
    } catch {
      return date.toLocaleDateString("ar-EG");
    }
  }
};

/** Gregorian date in Egypt, e.g. "الاثنين ٦ أكتوبر ٢٠٢٥". */
export const gregorianDate = (date: Date) =>
  safeFormat(
    { weekday: "long", day: "numeric", month: "long", year: "numeric", calendar: "gregory" },
    { day: "numeric", month: "long", year: "numeric" },
    date,
  );

/** Hijri (Umm al-Qura) date in Egypt, e.g. "٢٢ ربيع الآخر ١٤٤٧ هـ". */
export const hijriDate = (date: Date) => {
  const formatted = safeFormat(
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      calendar: "islamic-umalqura",
      numberingSystem: "arab",
    },
    { day: "numeric", month: "long", year: "numeric" },
    date,
  );
  return formatted.includes("هـ") ? formatted : `${formatted} هـ`;
};

export const clockTime = (date: Date) =>
  safeFormat(
    { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true },
    { hour: "2-digit", minute: "2-digit" },
    date,
  );

export const sessionAge = (sinceIso: string, now: Date = new Date()) => {
  const started = new Date(sinceIso).getTime();
  if (!Number.isFinite(started)) return "—";
  const minutes = Math.max(0, Math.floor((now.getTime() - started) / 60_000));
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} ساعة و${rest} دقيقة` : `${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `${days} يوم و${hours % 24} ساعة`;
};

export const shortDateTime = (iso: string) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return safeFormat(
    { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" },
    { day: "2-digit", month: "2-digit", year: "numeric" },
    date,
  );
};

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
};
