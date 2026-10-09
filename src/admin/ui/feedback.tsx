// Asynchronous states: skeletons, empty/error states and the toast system,
// plus the one place that turns an API failure into Arabic an operator can act on.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiFailure } from "../api";
import { Icons } from "../icons";
import { Button, IconButton } from "./primitives";

/* ------------------------------------------------------------- placeholders */

export function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
  className = "",
}: {
  width?: string | number;
  height?: number;
  radius?: number;
  className?: string;
}) {
  return (
    <span
      className={`skeleton${className ? ` ${className}` : ""}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonLines({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-lines" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} width={index % 2 ? "72%" : "92%"} height={12} />
      ))}
    </div>
  );
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <Skeleton width="42%" height={18} />
      <SkeletonLines rows={rows} />
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton-card">
          <Skeleton height={120} radius={12} />
          <Skeleton width="60%" height={16} />
          <Skeleton width="84%" height={11} />
          <Skeleton width="44%" height={11} />
        </div>
      ))}
    </div>
  );
}

/** Stacked rows placeholder (lists, tables, activity feeds). */
export function SkeletonRows({
  rows = 4,
  height = 56,
}: {
  rows?: number;
  height?: number;
}) {
  return (
    <div className="skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} height={height} radius={12} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- messages */

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? " empty-state--compact" : ""}`}>
      {icon && (
        <span className="empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/** Failed async section: explain, then offer the retry. */
export function ErrorState({
  title = "تعذّر تحميل البيانات",
  description,
  onRetry,
  retryLabel = "إعادة المحاولة",
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="error-state" role="alert">
      <span className="error-state-icon" aria-hidden="true">
        <Icons.alert size={22} />
      </span>
      <div className="error-state-text">
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          icon={<Icons.refresh size={15} />}
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ toasts */

type ToastTone = "success" | "error" | "info";
type Toast = { id: number; tone: ToastTone; text: string };
type ToastApi = { push: (tone: ToastTone, text: string) => void };

const ToastContext = createContext<ToastApi>({ push: () => {} });

const TOAST_LIFETIME = 4600;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, text: string) => {
      const id = Date.now() + Math.random();
      setItems((current) => [...current.slice(-2), { id, tone, text }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), TOAST_LIFETIME),
      );
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="dash toast-stack" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast--${item.tone}`}>
            <span className="toast-icon" aria-hidden="true">
              {item.tone === "success" ? (
                <Icons.checkCircle size={18} />
              ) : item.tone === "error" ? (
                <Icons.error size={18} />
              ) : (
                <Icons.info size={18} />
              )}
            </span>
            <span className="toast-text">{item.text}</span>
            <IconButton
              label="إخفاء التنبيه"
              size="sm"
              icon={<Icons.close size={15} />}
              onClick={() => dismiss(item.id)}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ----------------------------------------------------------- error messages */

/** Specific, actionable messages for the error codes the API returns. */
const ERROR_MESSAGES: Record<string, string> = {
  "invalid-current-answer": "الإجابة الحالية غير صحيحة.",
  "invalid-current-password": "كلمة المرور الحالية غير صحيحة.",
  "invalid-security-answer": "إجابة سؤال الأمان غير صحيحة.",
  "invalid-credentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "email-taken": "البريد الإلكتروني مستخدم بالفعل.",
  "username-taken": "اسم المستخدم مستخدم بالفعل.",
  "last-owner": "لا يمكن إزالة صلاحية آخر حساب مالك.",
  "cannot-delete-self": "لا يمكنك حذف حسابك الحالي.",
  "profile-incomplete": "أكمل بيانات حسابك أولًا.",
  "unsupported-type":
    "صيغة الملف غير مدعومة. المسموح: PNG أو JPG أو JPEG أو GIF أو WebP.",
  "file-too-large": "حجم الصورة كبير. الحد الأقصى ٥ ميجابايت.",
  "no-file": "لم يتم اختيار ملف.",
  "empty-file": "الملف فارغ.",
  "upload-failed": "تعذّر رفع الصورة. حاول مرة أخرى.",
  "revision-conflict":
    "عُدّل المحتوى من مكان آخر — حدّث الصفحة وحاول مرة أخرى.",
  "too-many-requests": "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.",
  "too-many-attempts":
    "محاولات دخول خاطئة كثيرة على هذا الحساب. انتظر قليلًا ثم أعد المحاولة.",
  "password-too-common":
    "كلمة المرور شائعة جدًا وسهلة التخمين. اختر كلمة مرور أقوى.",
  "password-too-simple": "كلمة المرور بسيطة جدًا. اختر كلمة مرور أقوى.",
  "password-matches-account":
    "كلمة المرور لا يجب أن تحتوي على اسم المستخدم أو البريد الإلكتروني.",
  "password-too-short": "كلمة المرور يجب ألا تقل عن ١٢ حرفًا.",
  "request-key-conflict": "تم إرسال طلب مختلف بنفس المفتاح. أعد المحاولة.",
  "image-host-not-allowed": "رابط الصورة من نطاق غير مسموح به في هذا الإعداد.",
  "payload-too-large": "البيانات المرسلة كبيرة جدًا.",
  "invalid-json": "تعذّر قراءة البيانات المرسلة.",
  "invalid-product": "راجع بيانات المنتج.",
  "invalid-event": "راجع بيانات المناسبة.",
  "invalid-content": "راجع الحقول المميزة بالأحمر ثم أعد النشر.",
  "owner-only": "ليست لديك صلاحية لهذا الإجراء.",
  "csrf-rejected": "انتهت صلاحية الجلسة. حدّث الصفحة ثم أعد المحاولة.",
};

/** Turns any thrown value into a message the dashboard can show the operator. */
export function describeError(error: unknown): string {
  if (error instanceof ApiFailure) {
    const code = (error.payload as { error?: string } | null)?.error;
    if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
    switch (error.status) {
      case 401:
        return "انتهت الجلسة أو أن البيانات غير صحيحة. سجّل الدخول من جديد.";
      case 403:
        return "ليست لديك صلاحية لهذا الإجراء.";
      case 409:
        return "حدث تعارض: عُدّل المحتوى من مكان آخر. حدّث الصفحة وحاول مرة أخرى.";
      case 413:
        return "الملف كبير جدًا (الحد ٥ ميجابايت).";
      case 422:
        return "راجع البيانات المدخلة.";
      case 428:
        return "أكمل بيانات حسابك أولًا.";
      default:
        return "تعذّر تنفيذ العملية. حاول مرة أخرى.";
    }
  }
  if (error instanceof TypeError)
    return "تعذّر الاتصال بالسيرفر. تحقق من الشبكة.";
  return "حدث خطأ غير متوقع.";
}

export const fieldErrorsOf = (error: unknown): Record<string, string> => {
  if (error instanceof ApiFailure && error.status === 422) {
    const details = (
      error.payload as { details?: Record<string, string[]> } | null
    )?.details;
    if (details) {
      const flat: Record<string, string> = {};
      for (const [key, messages] of Object.entries(details)) {
        if (messages?.length) flat[key] = messages[0];
      }
      return flat;
    }
  }
  return {};
};
