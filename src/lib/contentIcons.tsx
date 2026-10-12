/**
 * Semantic icon catalogue for editable content ("لماذا نحن").
 *
 * Administrators never see component names: the dashboard shows the rendered
 * icon plus an Arabic label, and stores a short, stable key such as `leaf`.
 * The catalogue is the single place that maps a key to a real icon, so the
 * public site and the dashboard can never drift apart.
 */
import {
  Award,
  BadgePercent,
  HeartHandshake,
  Leaf,
  Milk,
  PackageCheck,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Timer,
  Truck,
  Wheat,
  type LucideIcon,
} from "lucide-react";

export type ContentIcon = {
  /** Stable value stored in the content document. */
  key: string;
  /** What the administrator reads in the picker. */
  label: string;
  Icon: LucideIcon;
};

export const CONTENT_ICONS: ContentIcon[] = [
  { key: "leaf", label: "طبيعي ١٠٠٪", Icon: Leaf },
  { key: "quality", label: "جودة موثوقة", Icon: ShieldCheck },
  { key: "delivery", label: "توصيل سريع", Icon: Truck },
  { key: "price", label: "أسعار مناسبة", Icon: BadgePercent },
  { key: "dairy", label: "ألبان طازجة", Icon: Milk },
  { key: "farm", label: "من المزرعة", Icon: Wheat },
  { key: "packaging", label: "تعبئة وتغليف", Icon: PackageCheck },
  { key: "cold", label: "حفظ وتبريد", Icon: Snowflake },
  { key: "experience", label: "خبرة وثقة", Icon: Award },
  { key: "support", label: "خدمة ومتابعة", Icon: HeartHandshake },
  { key: "speed", label: "مواعيد دقيقة", Icon: Timer },
  { key: "hygiene", label: "نظافة ومعايير", Icon: Sparkles },
];

/** Values written by older versions of the dashboard (raw component names). */
const LEGACY_KEYS: Record<string, string> = {
  leaf: "leaf",
  shieldcheck: "quality",
  shield: "quality",
  truck: "delivery",
  badgepercent: "price",
  percent: "price",
  milk: "dairy",
  wheat: "farm",
  award: "experience",
  sparkles: "hygiene",
  timer: "speed",
  snowflake: "cold",
  packagecheck: "packaging",
  hearthandshake: "support",
};

export const DEFAULT_CONTENT_ICON = CONTENT_ICONS[0];

/** Resolves any stored value (new key, legacy component name, empty) to a catalogue entry. */
export const resolveContentIcon = (value: string | undefined): ContentIcon => {
  const needle = (value ?? "").trim().toLowerCase();
  if (!needle) return DEFAULT_CONTENT_ICON;
  const direct = CONTENT_ICONS.find((icon) => icon.key === needle);
  if (direct) return direct;
  const legacy = LEGACY_KEYS[needle.replace(/[\s_-]/g, "")];
  return (
    CONTENT_ICONS.find((icon) => icon.key === legacy) ?? DEFAULT_CONTENT_ICON
  );
};

/** Convenience renderer used by the public site. */
export function ContentIconGlyph({
  value,
  size = 24,
  strokeWidth = 1.7,
  className,
}: {
  value: string | undefined;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const { Icon } = resolveContentIcon(value);
  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden="true"
    />
  );
}
