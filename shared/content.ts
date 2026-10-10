// Shared content contract between the Express backend, the public site and the admin dashboard.
// src/data.ts stays the owner-editable seed: it is used to create DEFAULT_CONTENT, which seeds a
// brand-new database exactly once. After that, the database is the source of truth and editing
// src/data.ts no longer overwrites published content.
import { z } from "zod";
import {
  ADDRESS_TEXT,
  CATEGORIES,
  CONTENT_STATUS,
  COPY,
  FAQS,
  GALLERY,
  IMAGES,
  MAPS_URL,
  PRODUCTS,
  SECTION_NAMES,
  SEO_TITLE,
  SITE,
  STATS,
  TESTIMONIALS,
  WA_NUMBER,
  WHOLESALE_UNITS,
  WHY_US,
} from "../src/data.ts";

// TODO: description mirrors index.html; owner to confirm final marketing copy.
export const SEO_DESCRIPTION =
  "البان إلباظ: تصنيع وتعبئة وتغليف الألبان والأجبان والعسل الطبيعي وزيت الزيتون والمكسرات. نلبي جميع الطلبات وبكل الكميات.";

/**
 * URL policy.
 *
 * Links: an absolute http(s) URL or a same-origin absolute path. Protocol-relative
 * URLs (`//host`) are deliberately rejected — they are a classic validator bypass
 * and buy nothing over an explicit scheme.
 *
 * Images: must be https (or a same-origin path). This is what the CSP allows, so
 * validation and the browser agree; it also keeps `javascript:`, `data:`,
 * `vbscript:` and `file:` out of every src/href we render.
 */
const LINK_URL = /^https?:\/\/[^\s]+$/i;
const IMAGE_URL = /^https:\/\/[^\s]+$/i;
// A same-origin path: "/x", but never "//host" (protocol-relative).
const SAME_ORIGIN_PATH = /^\/(?!\/)[^\s]*$/;

export const isSafeUrl = (value: string) =>
  value === "" || SAME_ORIGIN_PATH.test(value) || LINK_URL.test(value);

export const isSafeImageUrl = (value: string) =>
  value === "" || SAME_ORIGIN_PATH.test(value) || IMAGE_URL.test(value);

const urlField = (
  label: string,
  { required = false, image = false }: { required?: boolean; image?: boolean },
) => {
  const base = z
    .string()
    .trim()
    .max(2048)
    .refine((v) => (required ? v !== "" : true), { message: `${label} مطلوب` })
    .refine(image ? isSafeImageUrl : isSafeUrl, {
      message: image
        ? `${label} يجب أن يبدأ بـ https:// أو / (مسار داخلي)`
        : `${label} غير صالح`,
    });
  // Optional URLs default to "" so a form can omit them entirely.
  return required ? base : base.default("");
};

/** A link: http(s) or same-origin path. */
export const safeUrl = (label: string, required = false) =>
  urlField(label, { required });

/** An image: https or same-origin path (matches the CSP img-src). */
export const safeImageUrl = (label: string, required = false) =>
  urlField(label, { required, image: true });

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: "لون غير صالح" });

const text = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, { message: `${label} قصير جدًا` })
    .max(max, { message: `${label} طويل جدًا` });

/** How a product can be ordered. Drives both the dashboard and the public badges. */
export const AVAILABILITY = [
  "available",
  "unlimited",
  "made_to_order",
  "coming_soon",
] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: "متاح",
  unlimited: "متاح بكميات غير محدودة",
  made_to_order: "يُصنع حسب الطلب",
  coming_soon: "قريبًا",
};

/**
 * Authenticity of a single piece of content (a product photo, a review).
 *
 * Three states on purpose:
 *  - `genuine`      — an administrator confirmed this is the real thing.
 *  - `illustrative` — an administrator marked it as a temporary stand-in.
 *  - `unspecified`  — nobody has decided yet. Never guessed from the data
 *    itself (a URL, an upload or a rating prove nothing); the legacy
 *    `contentStatus` flags below decide how an unspecified record is shown,
 *    which keeps every pre-existing document rendering exactly as before.
 */
export const AUTHENTICITY = ["unspecified", "genuine", "illustrative"] as const;
export type Authenticity = (typeof AUTHENTICITY)[number];
/** Optional everywhere: an older stored document simply reads as "unspecified". */
export const authenticitySchema = z.enum(AUTHENTICITY).default("unspecified");

export const PRODUCT_IMAGE_AUTHENTICITY_LABELS: Record<Authenticity, string> = {
  unspecified: "لم يُحدَّد بعد",
  genuine: "صورة المنتج الحقيقية",
  illustrative: "صورة توضيحية مؤقتة",
};

export const REVIEW_AUTHENTICITY_LABELS: Record<Authenticity, string> = {
  unspecified: "لم يُحدَّد بعد",
  genuine: "رأي عميل حقيقي",
  illustrative: "رأي توضيحي (نموذج)",
};

export const productSchema = z.object({
  id: z.number().int().positive(),
  category: text(1, 60, "التصنيف"),
  name: text(1, 120, "اسم المنتج"),
  desc: text(1, 400, "الوصف"),
  longDesc: z.string().trim().max(800).default(""),
  size: z.string().trim().max(60).default("—"),
  /** Empty is allowed: the site falls back to the product colour + name. */
  img: safeImageUrl("رابط الصورة"),
  fallback: safeImageUrl("رابط الصورة البديلة"),
  webp: safeImageUrl("رابط WebP"),
  color: hexColor.default("#f3e3c3"),
  // ---- orderability / stock (all optional so pre-existing content still loads) ----
  availability: z.enum(AVAILABILITY).default("available"),
  /** null means "not tracked" (e.g. unlimited). */
  quantity: z.number().finite().min(0).max(1_000_000).nullable().default(null),
  /** Shows the red NEW badge on the public site. */
  isNew: z.boolean().default(false),
  /** Optional ISO date after which the NEW badge hides itself. */
  newUntil: z.string().trim().max(40).default(""),
  /** Optional promotion/discount shown as a badge. 0 disables it. */
  discountPercent: z.number().finite().min(0).max(90).default(0),
  /** Optional free-text badge (e.g. "عرض الموسم"); empty hides it. */
  badge: z.string().trim().max(24).default(""),
  /**
   * Is the picture above the product's own photo, or a stand-in?
   * Set by an administrator in the dashboard. Missing = "unspecified", which
   * falls back to the legacy `contentStatus.placeholderProductIds` list.
   */
  imageAuthenticity: authenticitySchema,
});

export const heroSlideSchema = z.object({
  src: safeImageUrl("رابط الصورة", true),
  webp: safeImageUrl("رابط WebP"),
  fallback: safeImageUrl("رابط الصورة البديلة"),
  bg: hexColor,
  panel: hexColor,
  name: text(1, 120, "اسم الشريحة"),
  desc: text(1, 400, "وصف الشريحة"),
});

export const faqSchema = z.object({
  q: text(1, 200, "السؤال"),
  a: text(1, 800, "الإجابة"),
});

/**
 * Customer rating.
 *
 * Decimals are first-class: 4.5 and 4.8 are valid and are stored as written.
 * Only the range is enforced (1…5) plus a single decimal place, so the star
 * control, a typed value and the public site always agree. 0, 5.1, -1, 10 and
 * NaN are rejected by the schema, never silently rounded into range.
 */
export const RATING_MIN = 1;
export const RATING_MAX = 5;
/** The star control steps in halves; typed values may use one decimal. */
export const RATING_STEP = 0.5;
export const RATING_PRECISION_STEP = 0.1;

/** Keeps one decimal place (4.5 → 4.5, 4.85 → 4.9) without changing the value's meaning. */
export const roundRating = (value: number) => Math.round(value * 10) / 10;

/** Clamps a typed number into the valid range — used by the UI, never by the schema. */
export const clampRating = (value: number) =>
  roundRating(Math.min(RATING_MAX, Math.max(RATING_MIN, value)));

export const ratingSchema = z
  .number({ invalid_type_error: "التقييم يجب أن يكون رقمًا بين ١ و٥" })
  .finite({ message: "التقييم غير صالح" })
  .min(RATING_MIN, { message: "أقل تقييم هو ١" })
  .max(RATING_MAX, { message: "أعلى تقييم هو ٥" })
  .transform(roundRating);

export const reviewSchema = z.object({
  name: text(1, 80, "الاسم"),
  role: text(1, 80, "الصفة"),
  rating: ratingSchema,
  text: text(1, 600, "النص"),
  /**
   * A real customer opinion, or a sample written to fill the section?
   * Never derived from the rating: a genuine one-star review is still genuine.
   * Missing = "unspecified", which falls back to the legacy
   * `contentStatus.testimonialsArePlaceholders` switch.
   */
  authenticity: authenticitySchema,
});
export const galleryItemSchema = z.object({
  src: safeImageUrl("رابط الصورة"),
  caption: text(1, 120, "الوصف"),
});
export const statSchema = z.object({
  value: z.number().finite().min(0),
  suffix: z.string().trim().max(8),
  label: text(1, 60, "المسمى"),
});
export const whyUsItemSchema = z.object({
  icon: z.string().trim().max(40),
  title: text(1, 80, "العنوان"),
  text: text(1, 300, "النص"),
});

export const siteSchema = z.object({
  name: text(1, 120, "اسم النشاط"),
  email: z
    .string()
    .trim()
    .max(160)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: "بريد إلكتروني غير صالح",
    }),
  phone: text(1, 40, "رقم الهاتف"),
  secondPhone: z.string().trim().max(40),
  domain: safeUrl("رابط الموقع"),
  facebook: safeUrl("رابط فيسبوك"),
  instagram: safeUrl("رابط إنستجرام"),
  credit: safeUrl("رابط الحقوق"),
  address: z.string().trim().max(300),
  mapsUrl: safeUrl("رابط الخريطة"),
  logoUrl: safeImageUrl("رابط الشعار"),
  whatsapp: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, { message: "رقم واتساب غير صالح" }),
});

export const copySchema = z.object({
  heroEyebrow: text(1, 120, "نص علوي"),
  heroTagline: text(1, 120, "الشعار"),
  heroSeal: text(1, 120, "ختم"),
  productsSubtitle: text(1, 200, "وصف المنتجات"),
  whySubtitle: text(1, 200, "وصف لماذا نحن"),
  aboutTagline: text(1, 200, "وصف من نحن"),
  aboutDescription: text(1, 3000, "نبذة"),
  aboutChips: z.array(text(1, 80, "الوسم")).max(12),
  gallerySubtitle: text(1, 200, "وصف المعرض"),
  testimonialSubtitle: text(1, 200, "وصف الآراء"),
  contactSubtitle: text(1, 200, "وصف التواصل"),
});

export const contentStatusSchema = z.object({
  statsArePlaceholders: z.boolean(),
  testimonialsArePlaceholders: z.boolean(),
  placeholderProductIds: z.array(z.number().int().positive()).max(50),
  reviewsArePlaceholders: z.boolean().default(true),
  galleryArePlaceholders: z.boolean().default(true),
  addressIsPlaceholder: z.boolean().default(true),
});

export const EVENT_TYPES = [
  "new_product",
  "discount",
  "offer",
  "promotion",
  "seasonal",
  "announcement",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  new_product: "منتج جديد",
  discount: "خصم",
  offer: "عرض خاص",
  promotion: "حملة ترويجية",
  seasonal: "مناسبة موسمية",
  announcement: "إعلان مهم",
  other: "أخرى",
};

const isoOrEmpty = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), {
    message: "تاريخ غير صالح",
  })
  .default("");

export const eventSchema = z
  .object({
    title: text(1, 140, "عنوان الإعلان"),
    description: z.string().trim().max(1200).default(""),
    imageUrl: safeImageUrl("رابط الصورة"),
    type: z.enum(EVENT_TYPES).default("announcement"),
    startAt: isoOrEmpty,
    endAt: isoOrEmpty,
    active: z.boolean().default(true),
  })
  .refine(
    (v) =>
      !v.startAt || !v.endAt || Date.parse(v.startAt) <= Date.parse(v.endAt),
    {
      message: "تاريخ البداية يجب أن يسبق تاريخ النهاية",
      path: ["endAt"],
    },
  );

export type EventInput = z.infer<typeof eventSchema>;
export type SiteEvent = EventInput & {
  id: number;
  createdAt: string;
  updatedAt: string;
};

export const seoSchema = z.object({
  title: text(1, 200, "عنوان SEO"),
  description: text(1, 400, "وصف SEO"),
});

/** The full editable document, minus the database-managed revision. */
export const contentSchema = z.object({
  site: siteSchema,
  hero: z.object({
    eyebrow: text(1, 120, "نص علوي"),
    tagline: text(1, 120, "الشعار"),
    seal: text(1, 120, "ختم"),
    slides: z.array(heroSlideSchema).min(1).max(12),
  }),
  copy: copySchema,
  categories: z
    .array(text(1, 60, "التصنيف"))
    .min(1)
    .max(30),
  products: z.array(productSchema).max(200),
  whyUs: z.array(whyUsItemSchema).max(12),
  stats: z.array(statSchema).max(12),
  gallery: z.array(galleryItemSchema).max(60),
  reviews: z.array(reviewSchema).max(60),
  faqs: z.array(faqSchema).max(60),
  sectionNames: z.array(text(1, 60, "اسم القسم")).length(8),
  units: z
    .array(text(1, 40, "الوحدة"))
    .min(1)
    .max(12),
  contentStatus: contentStatusSchema,
  seo: seoSchema,
});

export type Content = z.infer<typeof contentSchema>;

/* --------------------------------------------------------- display helpers */

/**
 * True when a product should still show the red "NEW" badge. An optional
 * `newUntil` date hides the badge automatically once that day is over, so the
 * dashboard can set an end date instead of remembering to switch it off.
 */
export const isNewBadgeActive = (
  product: Pick<Product, "isNew" | "newUntil">,
  now: Date = new Date(),
): boolean => {
  if (!product.isNew) return false;
  if (!product.newUntil) return true;
  const until = new Date(`${product.newUntil}T23:59:59`);
  if (Number.isNaN(until.getTime())) return true;
  return until.getTime() >= now.getTime();
};

/** Human label for the stock state, or null when there is nothing to announce. */
export const stockLabel = (
  product: Pick<Product, "availability" | "quantity">,
) => {
  if (product.availability === "coming_soon")
    return AVAILABILITY_LABELS.coming_soon;
  if (product.availability === "made_to_order")
    return AVAILABILITY_LABELS.made_to_order;
  if (product.quantity === 0) return "نفدت الكمية";
  if (product.availability === "unlimited")
    return AVAILABILITY_LABELS.unlimited;
  return null;
};

/** Products that cannot be ordered right now. */
export const isOrderable = (
  product: Pick<Product, "availability" | "quantity">,
) => product.availability !== "coming_soon" && product.quantity !== 0;
export type ContentDoc = Content & { revision: number };
export type Product = z.infer<typeof productSchema>;
export type HeroSlide = z.infer<typeof heroSlideSchema>;
export type Faq = z.infer<typeof faqSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type GalleryItem = z.infer<typeof galleryItemSchema>;
export type ContentStatus = z.infer<typeof contentStatusSchema>;

/* ---------------------------------------------------------------------------
 * Authenticity rules — one implementation, used by the public site, the
 * dashboard preview and the tests, so the three can never disagree.
 * -------------------------------------------------------------------------*/

/**
 * Should the "الصورة توضيحية" disclaimer appear under this product?
 *
 * An explicit per-product decision always wins. Only when an administrator has
 * not decided yet do we consult the legacy id list, which is how every
 * document written before this field existed keeps its current appearance.
 */
export const productImageIsIllustrative = (
  product: Pick<Product, "id" | "imageAuthenticity">,
  status: Pick<ContentStatus, "placeholderProductIds">,
): boolean => {
  if (product.imageAuthenticity === "genuine") return false;
  if (product.imageAuthenticity === "illustrative") return true;
  return status.placeholderProductIds.includes(product.id);
};

/**
 * Should the "رأي توضيحي" disclaimer appear under this review?
 *
 * The rating is deliberately not part of the decision: a genuine complaint
 * rated 1/5 is still a genuine customer opinion.
 */
export const reviewIsIllustrative = (
  review: Pick<Review, "authenticity">,
  status: Pick<ContentStatus, "testimonialsArePlaceholders">,
): boolean => {
  if (review.authenticity === "genuine") return false;
  if (review.authenticity === "illustrative") return true;
  return status.testimonialsArePlaceholders;
};

/** Products still shown as illustrative only because of the legacy id list. */
export const unclassifiedIllustrativeProducts = <
  T extends Pick<Product, "id" | "imageAuthenticity">,
>(
  products: T[],
  status: Pick<ContentStatus, "placeholderProductIds">,
): T[] =>
  products.filter(
    (product) =>
      product.imageAuthenticity === "unspecified" &&
      status.placeholderProductIds.includes(product.id),
  );

/**
 * Reviews still shown as illustrative only because the global
 * `testimonialsArePlaceholders` switch is on and nobody has classified them.
 * These are the ones the dashboard offers to settle in one step.
 */
export const unclassifiedIllustrativeReviews = <
  T extends Pick<Review, "authenticity">,
>(
  reviews: T[],
  status: Pick<ContentStatus, "testimonialsArePlaceholders">,
): T[] =>
  status.testimonialsArePlaceholders
    ? reviews.filter((review) => review.authenticity === "unspecified")
    : [];

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The seed for a brand-new database. Built from the existing owner-editable src/data.ts so the
 * launch content stays exactly what the owner wrote — nothing is invented here.
 */
export const DEFAULT_CONTENT: Content = contentSchema.parse({
  site: {
    ...SITE,
    address: ADDRESS_TEXT,
    mapsUrl: MAPS_URL,
    logoUrl: "",
    whatsapp: WA_NUMBER,
  },
  hero: {
    eyebrow: COPY.heroEyebrow,
    tagline: COPY.heroTagline,
    seal: COPY.heroSeal,
    slides: plain(IMAGES),
  },
  copy: plain(COPY),
  categories: plain(CATEGORIES),
  products: plain(PRODUCTS),
  whyUs: plain(WHY_US),
  stats: plain(STATS),
  gallery: plain(GALLERY),
  reviews: plain(TESTIMONIALS),
  faqs: plain(FAQS),
  sectionNames: plain(SECTION_NAMES),
  units: plain(WHOLESALE_UNITS),
  contentStatus: {
    ...CONTENT_STATUS,
    reviewsArePlaceholders: true,
    galleryArePlaceholders: true,
    addressIsPlaceholder: true,
  },
  seo: { title: SEO_TITLE, description: SEO_DESCRIPTION },
});

// ---------------------------------------------------------------------------
// Wholesale requests
// ---------------------------------------------------------------------------

export const REQUEST_STATUSES = [
  "new",
  "contacted",
  "confirmed",
  "archived",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  new: "جديد",
  contacted: "تم التواصل",
  confirmed: "مؤكد",
  archived: "مؤرشف",
};

/** Digits, spaces and the usual phone punctuation only — no markup, no smuggling. */
const contactNumber = z
  .string()
  .trim()
  .min(6, { message: "رقم تواصل قصير جدًا" })
  .max(32, { message: "رقم تواصل طويل جدًا" })
  .refine((v) => /^[+()\-\s0-9]+$/.test(v), { message: "رقم تواصل غير صالح" })
  .refine((v) => (v.match(/[0-9]/g) ?? []).length >= 6, {
    message: "رقم تواصل غير صالح",
  });

export const wholesaleRequestSchema = z.object({
  name: text(2, 120, "الاسم"),
  contact: contactNumber,
  product: text(1, 120, "المنتج"),
  unit: text(1, 40, "الوحدة"),
  quantity: z.coerce
    .number({ invalid_type_error: "كمية غير صالحة" })
    .refine((v) => Number.isFinite(v), { message: "كمية غير صالحة" })
    .refine((v) => v > 0, { message: "الكمية يجب أن تكون أكبر من صفر" })
    .refine((v) => v <= 100000, { message: "الكمية كبيرة جدًا" }),
  notes: z.string().trim().max(1000).default(""),
  consent: z.literal(true, {
    errorMap: () => ({ message: "يجب الموافقة على تخزين البيانات" }),
  }),
  // Bots fill hidden fields; humans never see them.
  honeypot: z
    .string()
    .max(0, { message: "تم رفض الطلب" })
    .optional()
    .default(""),
  requestKey: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{8,80}$/, { message: "مفتاح الطلب غير صالح" })
    .optional(),
});

export type WholesaleRequestInput = z.input<typeof wholesaleRequestSchema>;
export type WholesaleRequest = {
  id: number;
  name: string;
  contact: string;
  product: string;
  unit: string;
  quantity: number;
  notes: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Admin auth
// ---------------------------------------------------------------------------

export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, { message: "اسم المستخدم قصير جدًا" })
    .max(60, { message: "اسم المستخدم طويل جدًا" })
    .regex(/^[A-Za-z0-9._@-]+$/, {
      message: "اسم المستخدم يحتوي على رموز غير مسموحة",
    }),
  password: z
    .string()
    .min(12, { message: "كلمة المرور يجب ألا تقل عن 12 حرفًا" })
    .max(200, { message: "كلمة المرور طويلة جدًا" }),
});

export const setupSchema = credentialsSchema.extend({
  token: z.string().trim().length(64, { message: "رمز الإعداد غير صالح" }),
});

export const ROLES = ["owner", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const emailSchema = z
  .string()
  .trim()
  .max(160)
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
    message: "بريد إلكتروني غير صالح",
  });

const displayName = z
  .string()
  .trim()
  .min(1, { message: "الاسم المعروض مطلوب" })
  .max(80, { message: "الاسم المعروض طويل جدًا" });

const question = z
  .string()
  .trim()
  .min(4, { message: "سؤال الأمان قصير جدًا" })
  .max(200, { message: "سؤال الأمان طويل جدًا" });

const answer = z
  .string()
  .trim()
  .min(2, { message: "إجابة سؤال الأمان قصيرة جدًا" })
  .max(200, { message: "إجابة سؤال الأمان طويلة جدًا" });

/** Login accepts either the username or the account email. */
export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, { message: "من فضلك أدخل اسم المستخدم أو البريد" })
    .max(160),
  password: z.string().min(1, { message: "من فضلك أدخل كلمة المرور" }).max(200),
});

export const securityAnswerSchema = z.object({
  answer,
});

/** Owner completing their permanent credentials on first entry. */
export const completeProfileSchema = z.object({
  displayName,
  email: emailSchema,
  password: z
    .string()
    .min(12, { message: "كلمة المرور يجب ألا تقل عن 12 حرفًا" })
    .max(200, { message: "كلمة المرور طويلة جدًا" }),
  securityQuestion: question,
  securityAnswer: answer,
});

export const profileUpdateSchema = z.object({
  displayName,
  email: emailSchema,
  avatarUrl: safeImageUrl("رابط الصورة"),
});

export const passwordChangeSchema = z.object({
  currentPassword: z
    .string()
    .min(1, { message: "أدخل كلمة المرور الحالية" })
    .max(200),
  newPassword: z
    .string()
    .min(12, { message: "كلمة المرور يجب ألا تقل عن 12 حرفًا" })
    .max(200, { message: "كلمة المرور طويلة جدًا" }),
});

/**
 * Changing the security question. `currentAnswer` is only *required* when a
 * question already exists — the server enforces that, because setting the very
 * first question has nothing to confirm.
 */
export const securityChangeSchema = z.object({
  currentAnswer: z.string().max(200).default(""),
  securityQuestion: question,
  securityAnswer: answer,
});

/** Owner-only: create or edit another administrator. */
export const adminCreateSchema = z.object({
  username: credentialsSchema.shape.username,
  displayName,
  email: emailSchema,
  password: z
    .string()
    .min(12, { message: "كلمة المرور يجب ألا تقل عن 12 حرفًا" })
    .max(200, { message: "كلمة المرور طويلة جدًا" }),
  role: z.enum(ROLES).default("admin"),
});

export const adminUpdateSchema = z.object({
  username: credentialsSchema.shape.username,
  displayName,
  email: emailSchema,
  avatarUrl: safeImageUrl("رابط الصورة"),
  role: z.enum(ROLES),
  // Empty string keeps the existing password.
  password: z
    .string()
    .max(200)
    .refine((v) => v === "" || v.length >= 12, {
      message: "كلمة المرور يجب ألا تقل عن 12 حرفًا",
    })
    .default(""),
});

export type ApiError = { error: string; details?: unknown };
