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
export const safeUrl = (label: string, required = false) =>
  z
    .string()
    .trim()
    .max(2048)
    .refine((v) => (required ? v !== "" : true), { message: `${label} مطلوب` })
    .refine(isSafeUrl, { message: `${label} غير صالح` });

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

export const productSchema = z.object({
  id: z.number().int().positive(),
  category: text(1, 60, "التصنيف"),
  name: text(1, 120, "اسم المنتج"),
  desc: text(1, 400, "الوصف"),
  longDesc: z.string().trim().max(800).default(""),
  size: z.string().trim().max(60).default("—"),
  img: safeUrl("رابط الصورة", true),
  fallback: safeUrl("رابط الصورة البديلة"),
  webp: safeUrl("رابط WebP"),
  color: hexColor,
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

export type ApiError = { error: string; details?: unknown };
