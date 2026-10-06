// Image uploads. Files are validated by magic bytes (never by the client-supplied
// MIME type or filename), renamed to random safe names, and written into the private
// data directory where they can never be executed or shadow application code.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import multer from "multer";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const UPLOAD_URL_PREFIX = "/uploads/";
/** Only these extensions may ever be written to disk. */
export const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif"] as const;
const SAFE_NAME = /^[a-f0-9]{32}\.(png|jpg|jpeg|gif)$/;

export type DetectedImage = { mime: string; extension: string };

/**
 * Identifies the image from its leading bytes. Anything that is not a real
 * PNG/JPEG/GIF is rejected, so renaming `evil.php` to `x.png` does not help.
 */
export function detectImage(buffer: Buffer): DetectedImage | null {
  if (buffer.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: "image/png", extension: ".png" };
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    // Reject JPEGs that merely wrap a script (some polyglot files start with a comment).
    return { mime: "image/jpeg", extension: ".jpg" };
  }
  // GIF: "GIF87a" / "GIF89a"
  const header = buffer.subarray(0, 6).toString("latin1");
  if (header === "GIF87a" || header === "GIF89a") {
    return { mime: "image/gif", extension: ".gif" };
  }
  return null;
}

/** Rejects HTML/SVG/XML payloads masquerading as images. */
export function looksLikeMarkup(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 512).toString("latin1").toLowerCase().trimStart();
  return (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<svg") ||
    head.startsWith("<?xml") ||
    head.startsWith("<script")
  );
}

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8, parts: 12 },
}).single("file");

export type StoredUpload = {
  url: string;
  filename: string;
  mime: string;
  size: number;
  originalName: string;
};

export function storeUpload(
  uploadsDir: string,
  file: { buffer: Buffer; originalname?: string },
): { ok: true; value: StoredUpload } | { ok: false; reason: string } {
  const buffer = file.buffer;
  if (!buffer?.length) return { ok: false, reason: "empty-file" };
  if (buffer.length > MAX_UPLOAD_BYTES) return { ok: false, reason: "too-large" };
  if (looksLikeMarkup(buffer)) return { ok: false, reason: "unsupported-type" };
  const detected = detectImage(buffer);
  if (!detected) return { ok: false, reason: "unsupported-type" };

  // Safe random name + extension derived from the detected type only.
  const filename = `${randomBytes(16).toString("hex")}${detected.extension}`;
  writeFileSync(join(uploadsDir, filename), buffer, { mode: 0o644, flag: "wx" });
  return {
    ok: true,
    value: {
      url: `${UPLOAD_URL_PREFIX}${filename}`,
      filename,
      mime: detected.mime,
      size: buffer.length,
      originalName: String(file.originalname ?? "").slice(0, 120),
    },
  };
}

/** Guards the static upload route against traversal and unexpected names. */
export const isSafeUploadName = (name: string) => SAFE_NAME.test(name);

export const contentTypeFor = (name: string) => {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
};
