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
 * Only http(s) URLs, protocol-relative URLs and same-origin absolute paths are accepted.
 * This is what keeps `javascript:` and `data:` URLs out of href/src attributes.
 */
const SAFE_URL = /^(?:https?:\/\/[^\s]+|\/\/[^\s]+|\/[^\s]*)$/i;
export const isSafeUrl = (value: string) => value === "" || SAFE_URL.test(value);
export const safeUrl = (label: string, required = false) => {
  const base = z
    .string()
    .trim()
    .max(2048)
    .refine((v) => (required ? v !== "" : true), { message: `${label} مطلوب` })
    .refine(isSafeUrl, { message: `${label} غير صالح` });
  // Optional URLs default to "" so a form can omit them entirely.
  return required ? base : base.default("");
};

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

export const productSchema = z.object({
  id: z.number().int().positive(),
  category: text(1, 60, "التصنيف"),
  name: text(1, 120, "اسم المنتج"),
  desc: text(1, 400, "الوصف"),
  longDesc: z.string().trim().max(800).default(""),
  size: z.string().trim().max(60).default("—"),
  /** Empty is allowed: the site falls back to the product colour + name. */
  img: safeUrl("رابط الصورة"),
  fallback: safeUrl("رابط الصورة البديلة"),
  webp: safeUrl("رابط WebP"),
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
});

export const heroSlideSchema = z.object({
  src: safeUrl("رابط الصورة", true),
  webp: safeUrl("رابط WebP"),
  fallback: safeUrl("رابط الصورة البديلة"),
  bg: hexColor,
  panel: hexColor,
  name: text(1, 120, "اسم الشريحة"),
  desc: text(1, 400, "وصف الشريحة"),
});

export const faqSchema = z.object({
  q: text(1, 200, "السؤال"),
  a: text(1, 800, "الإجابة"),
});
export const reviewSchema = z.object({
  name: text(1, 80, "الاسم"),
  role: text(1, 80, "الصفة"),
  rating: z.number().int().min(1).max(5),
  text: text(1, 600, "النص"),
});
export const galleryItemSchema = z.object({
  src: safeUrl("رابط الصورة"),
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
  email: z.string().trim().max(160).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
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
  logoUrl: safeUrl("رابط الشعار"),
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
  .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), { message: "تاريخ غير صالح" })
  .default("");

export const eventSchema = z
  .object({
    title: text(1, 140, "عنوان الإعلان"),
    description: z.string().trim().max(1200).default(""),
    imageUrl: safeUrl("رابط الصورة"),
    type: z.enum(EVENT_TYPES).default("announcement"),
    startAt: isoOrEmpty,
    endAt: isoOrEmpty,
    active: z.boolean().default(true),
  })
  .refine((v) => !v.startAt || !v.endAt || Date.parse(v.startAt) <= Date.parse(v.endAt), {
    message: "تاريخ البداية يجب أن يسبق تاريخ النهاية",
    path: ["endAt"],
  });

export type EventInput = z.infer<typeof eventSchema>;
export type SiteEvent = EventInput & { id: number; createdAt: string; updatedAt: string };

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
  categories: z.array(text(1, 60, "التصنيف")).min(1).max(30),
  products: z.array(productSchema).max(200),
  whyUs: z.array(whyUsItemSchema).max(12),
  stats: z.array(statSchema).max(12),
  gallery: z.array(galleryItemSchema).max(60),
  reviews: z.array(reviewSchema).max(60),
  faqs: z.array(faqSchema).max(60),
  sectionNames: z.array(text(1, 60, "اسم القسم")).length(8),
  units: z.array(text(1, 40, "الوحدة")).min(1).max(12),
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
export const stockLabel = (product: Pick<Product, "availability" | "quantity">) => {
  if (product.availability === "coming_soon") return AVAILABILITY_LABELS.coming_soon;
  if (product.availability === "made_to_order") return AVAILABILITY_LABELS.made_to_order;
  if (product.quantity === 0) return "نفدت الكمية";
  if (product.availability === "unlimited") return AVAILABILITY_LABELS.unlimited;
  return null;
};

/** Products that cannot be ordered right now. */
export const isOrderable = (product: Pick<Product, "availability" | "quantity">) =>
  product.availability !== "coming_soon" && product.quantity !== 0;
export type ContentDoc = Content & { revision: number };
export type Product = z.infer<typeof productSchema>;
export type HeroSlide = z.infer<typeof heroSlideSchema>;
export type Faq = z.infer<typeof faqSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type GalleryItem = z.infer<typeof galleryItemSchema>;

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
  contentStatus: { ...CONTENT_STATUS, reviewsArePlaceholders: true, galleryArePlaceholders: true, addressIsPlaceholder: true },
  seo: { title: SEO_TITLE, description: SEO_DESCRIPTION },
});

// ---------------------------------------------------------------------------
// Wholesale requests
// ---------------------------------------------------------------------------

export const REQUEST_STATUSES = ["new", "contacted", "confirmed", "archived"] as const;
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
  .refine((v) => (v.match(/[0-9]/g) ?? []).length >= 6, { message: "رقم تواصل غير صالح" });

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
  consent: z.literal(true, { errorMap: () => ({ message: "يجب الموافقة على تخزين البيانات" }) }),
  // Bots fill hidden fields; humans never see them.
  honeypot: z.string().max(0, { message: "تم رفض الطلب" }).optional().default(""),
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
    .regex(/^[A-Za-z0-9._@-]+$/, { message: "اسم المستخدم يحتوي على رموز غير مسموحة" }),
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
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "بريد إلكتروني غير صالح" });

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
  identifier: z.string().trim().min(1, { message: "من فضلك أدخل اسم المستخدم أو البريد" }).max(160),
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
  avatarUrl: safeUrl("رابط الصورة"),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, { message: "أدخل كلمة المرور الحالية" }).max(200),
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
  avatarUrl: safeUrl("رابط الصورة"),
  role: z.enum(ROLES),
  // Empty string keeps the existing password.
  password: z
    .string()
    .max(200)
    .refine((v) => v === "" || v.length >= 12, { message: "كلمة المرور يجب ألا تقل عن 12 حرفًا" })
    .default(""),
});

export type ApiError = { error: string; details?: unknown };
