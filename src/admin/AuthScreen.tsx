// Dashboard entrance: setup → first-run profile → login → security question →
// success. One calm, brand-forward card: no neon, no terminal, no gradients
// competing with the form. Every step validates in place before it calls the
// API, and the server stays the only authority on whether a login succeeds.
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiFailure, adminApi, setCsrfToken, type AdminSession } from "./api";
import { Button, Field, PasswordInput, TextInput, useToast } from "./ui";
import { Icons } from "./icons";
import ThemeToggle from "../components/ThemeToggle";
import { prefersReducedMotion } from "../theme/theme";

type Phase =
  | "checking"
  | "setup"
  | "complete"
  | "login"
  | "security"
  | "success";

const MESSAGES: Record<string, string> = {
  "invalid-setup-token":
    "رمز الإعداد غير صحيح. راجعه من ملف الإعداد على السيرفر.",
  "setup-already-complete":
    "تم إنشاء حساب المالك بالفعل. سجّل الدخول من فضلك.",
  "invalid-credentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "invalid-security-answer": "الإجابة غير صحيحة. حاول مرة أخرى.",
  "email-taken": "البريد الإلكتروني مستخدم بالفعل.",
  "username-taken": "اسم المستخدم مستخدم بالفعل.",
  "profile-already-complete": "هذا الحساب مكتمل بالفعل.",
  "too-many-requests": "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.",
  "too-many-attempts":
    "محاولات دخول خاطئة كثيرة على هذا الحساب. انتظر قليلًا ثم أعد المحاولة.",
  "password-too-common":
    "كلمة المرور شائعة جدًا وسهلة التخمين. اختر كلمة مرور أقوى.",
  "password-too-simple": "كلمة المرور بسيطة جدًا. اختر كلمة مرور أقوى.",
  "password-matches-account":
    "كلمة المرور لا يجب أن تحتوي على اسم المستخدم أو البريد الإلكتروني.",
};

const messageFor = (error: unknown) => {
  const code =
    error instanceof ApiFailure
      ? (error.payload as { error?: string } | null)?.error
      : "";
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (error instanceof ApiFailure && error.status === 422)
    return "راجع البيانات: كلمة المرور ١٢ حرفًا على الأقل.";
  if (error instanceof TypeError)
    return "تعذّر الاتصال بالسيرفر. تحقّق من الشبكة.";
  return "حدث خطأ غير متوقع. حاول مرة أخرى.";
};

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

export default function AuthScreen({
  onSuccess,
  initialPhase,
  initialQuestion = "",
}: {
  onSuccess: (session: AdminSession) => void;
  initialPhase: "setup" | "login" | "complete" | "security";
  initialQuestion?: string;
}) {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [token, setToken] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState(initialQuestion);
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  // Each step starts with focus on its first field.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const run = async (task: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await task();
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      setBusy(false);
    }
  };

  /** Client-side checks. The server validates everything again regardless. */
  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (phase === "setup") {
      if (!token.trim()) next.token = "أدخل رمز الإعداد.";
      if (password.length < 12)
        next.password = "كلمة المرور يجب ألا تقل عن ١٢ حرفًا.";
    }
    if (phase === "complete") {
      if (!displayName.trim()) next.displayName = "أدخل الاسم الذي سيظهر لك.";
      if (!isEmail(email.trim()))
        next.email = "أدخل بريدًا إلكترونيًا صحيحًا.";
      if (password.length < 12)
        next.password = "كلمة المرور يجب ألا تقل عن ١٢ حرفًا.";
      if (!question.trim()) next.question = "اكتب سؤال الأمان.";
      if (!answer.trim()) next.answer = "اكتب إجابة سؤال الأمان.";
    }
    if (phase === "login") {
      if (!identifier.trim())
        next.identifier = "أدخل بريدك الإلكتروني أو اسم المستخدم.";
      if (!password) next.password = "أدخل كلمة المرور.";
    }
    if (phase === "security" && !answer.trim())
      next.answer = "اكتب الإجابة للمتابعة.";
    setFieldErrors(next);
    if (Object.keys(next).length) {
      setError("");
      // Move focus to the first problem so the keyboard user sees it.
      requestAnimationFrame(() => {
        formRef.current
          ?.querySelector<HTMLElement>(".field--invalid input")
          ?.focus();
      });
      return false;
    }
    return true;
  };

  /* --------------------------------------------------------------- actions */

  const submitSetup = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    void run(async () => {
      const result = await adminApi.setup(token.trim(), "owner", password);
      setCsrfToken(result.csrf);
      setToken("");
      setPassword("");
      setNotice("تم إنشاء حساب المالك. أكمل الآن بيانات الدخول الشخصية.");
      setPhase("complete");
    });
  };

  const submitComplete = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    void run(async () => {
      await adminApi.completeProfile({
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        securityQuestion: question.trim(),
        securityAnswer: answer.trim(),
      });
      setPassword("");
      setAnswer("");
      setNotice(
        "تم حفظ البيانات. سجّل الدخول الآن بالبريد وكلمة المرور الجديدين.",
      );
      setPhase("login");
      setIdentifier(email.trim());
    });
  };

  const submitLogin = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    void run(async () => {
      const result = await adminApi.login(identifier.trim(), password);
      if ("requiresSecurityAnswer" in result && result.requiresSecurityAnswer) {
        setCsrfToken(result.pendingCsrf);
        setCurrentQuestion(result.question);
        setPassword("");
        setPhase("security");
        return;
      }
      setCsrfToken(result.csrf);
      await finish();
    });
  };

  const submitSecurity = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    void run(async () => {
      const result = await adminApi.loginSecurity(answer.trim());
      setCsrfToken(result.csrf);
      setAnswer("");
      await finish();
    });
  };

  /** Loads the full session, plays the success beat, then hands over. */
  const finish = async () => {
    const session = await adminApi.session();
    if (!session.authenticated)
      throw new ApiFailure(401, { error: "unauthenticated" });
    setCsrfToken(session.csrf);
    setPhase("success");
    const wait = prefersReducedMotion() ? 500 : 1500;
    await new Promise((resolve) => window.setTimeout(resolve, wait));
    onSuccess(session);
  };

  /* ---------------------------------------------------------------- render */

  const heading = useMemo(() => {
    switch (phase) {
      case "setup":
        return {
          title: "الإعداد الأول",
          sub: "أنشئ حساب المالك بخطوة واحدة آمنة.",
        };
      case "complete":
        return {
          title: "بيانات حسابك",
          sub: "بريدك وكلمة مرورك وسؤال الأمان — تُحفظ مشفّرة.",
        };
      case "security":
        return {
          title: "سؤال الأمان",
          sub: "خطوة تحقّق إضافية لحماية لوحة التحكم.",
        };
      default:
        return {
          title: "تسجيل الدخول",
          sub: "أهلًا بك في لوحة تحكم البان إلباظ.",
        };
    }
  }, [phase]);

  if (phase === "success") {
    return (
      <div className="auth-screen auth-screen--success dash">
        <div className="auth-success" role="status" aria-live="assertive">
          <span className="auth-success-ring" aria-hidden="true">
            <Icons.check size={38} strokeWidth={2.4} />
          </span>
          <h1>تم تسجيل الدخول بنجاح</h1>
          <p>جارٍ تجهيز لوحة التحكم…</p>
          <span className="auth-success-bar" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (phase === "checking") {
    return (
      <div className="auth-screen dash">
        <div className="auth-card auth-card--loading">
          <span className="skeleton" style={{ width: 148, height: 22 }} />
          <span className="skeleton" style={{ width: "100%", height: 46 }} />
          <span className="skeleton" style={{ width: "100%", height: 46 }} />
          <span className="skeleton" style={{ width: "64%", height: 40 }} />
        </div>
      </div>
    );
  }

  const steps =
    phase === "setup" || phase === "complete"
      ? [
          { key: "setup", label: "إنشاء الحساب" },
          { key: "complete", label: "بيانات الدخول" },
        ]
      : null;

  return (
    <div className="auth-screen dash">
      <div className="auth-card">
        <aside className="auth-brand">
          <div className="auth-brand-mark">
            <Icons.brand size={26} />
          </div>
          <h2>البان إلباظ</h2>
          <p>لوحة إدارة الموقع والمنتجات والطلبات، من مكان واحد.</p>
          <ul className="auth-points">
            <li>
              <Icons.package size={16} />
              إدارة المنتجات والصور والأسعار
            </li>
            <li>
              <Icons.events size={16} />
              العروض والمناسبات والتنبيهات
            </li>
            <li>
              <Icons.activity size={16} />
              تحديث فوري للموقع
            </li>
          </ul>
          <span className="auth-brand-foot">
            <Icons.shield size={15} />
            جلسات مشفّرة وحماية بصلاحيات
          </span>
        </aside>

        <div className="auth-form-side">
          <form
            ref={formRef}
            className="auth-form"
            noValidate
            onSubmit={
              phase === "setup"
                ? submitSetup
                : phase === "complete"
                  ? submitComplete
                  : phase === "security"
                    ? submitSecurity
                    : submitLogin
            }
          >
            <header className="auth-head">
              <div className="auth-head-row">
                <span className="auth-eyebrow">
                  {phase === "setup" ? (
                    <Icons.key size={15} />
                  ) : (
                    <Icons.lock size={15} />
                  )}
                  {phase === "security"
                    ? "تحقّق إضافي"
                    : phase === "setup"
                      ? "مرة واحدة"
                      : "منطقة آمنة"}
                </span>
                <ThemeToggle />
              </div>
              <h1>{heading.title}</h1>
              <p>{heading.sub}</p>
              {steps && (
                <ol className="auth-steps" aria-label="خطوات الإعداد">
                  {steps.map((step, index) => (
                    <li
                      key={step.key}
                      className={`auth-step${step.key === phase ? " is-active" : ""}${
                        phase === "complete" && index === 0 ? " is-done" : ""
                      }`}
                    >
                      <span className="auth-step-mark" aria-hidden="true">
                        {phase === "complete" && index === 0 ? (
                          <Icons.check size={13} />
                        ) : (
                          index + 1
                        )}
                      </span>
                      {step.label}
                    </li>
                  ))}
                </ol>
              )}
            </header>

            {notice && (
              <p className="auth-notice" role="status">
                <Icons.info size={16} />
                {notice}
              </p>
            )}

            {phase === "setup" && (
              <>
                <p className="auth-hint">
                  اقرأ الرمز من الملف <code dir="ltr">.data/setup-token</code>{" "}
                  على السيرفر. يُحذف بعد إنشاء الحساب ولا يظهر في الموقع العام.
                </p>
                <Field label="رمز الإعداد" required error={fieldErrors.token}>
                  <TextInput
                    value={token}
                    onChange={setToken}
                    dir="ltr"
                    autoComplete="off"
                    placeholder="64 حرفًا"
                    invalid={Boolean(fieldErrors.token)}
                  />
                </Field>
                <Field
                  label="كلمة مرور المالك"
                  required
                  hint="١٢ حرفًا على الأقل."
                  error={fieldErrors.password}
                >
                  <PasswordInput
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    invalid={Boolean(fieldErrors.password)}
                  />
                </Field>
              </>
            )}

            {phase === "complete" && (
              <>
                <Field
                  label="الاسم الظاهر"
                  required
                  error={fieldErrors.displayName}
                >
                  <TextInput
                    value={displayName}
                    onChange={setDisplayName}
                    placeholder="مثال: محمد نجيب"
                    invalid={Boolean(fieldErrors.displayName)}
                  />
                </Field>
                <Field
                  label="البريد الإلكتروني"
                  required
                  hint="يُستخدم لتسجيل الدخول لاحقًا."
                  error={fieldErrors.email}
                >
                  <TextInput
                    value={email}
                    onChange={setEmail}
                    type="email"
                    dir="ltr"
                    autoComplete="email"
                    placeholder="owner@example.com"
                    invalid={Boolean(fieldErrors.email)}
                  />
                </Field>
                <Field
                  label="كلمة المرور الجديدة"
                  required
                  hint="١٢ حرفًا على الأقل مع حروف وأرقام."
                  error={fieldErrors.password}
                >
                  <PasswordInput
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    invalid={Boolean(fieldErrors.password)}
                  />
                </Field>
                <Field
                  label="سؤال الأمان"
                  required
                  hint="اكتب سؤالًا تعرف إجابته وحدك."
                  error={fieldErrors.question}
                >
                  <TextInput
                    value={question}
                    onChange={setQuestion}
                    placeholder="مثال: مدينة الميلاد؟"
                    invalid={Boolean(fieldErrors.question)}
                  />
                </Field>
                <Field
                  label="إجابة سؤال الأمان"
                  required
                  hint="تُخزَّن مشفّرة ولا تظهر أبدًا في أي شاشة."
                  error={fieldErrors.answer}
                >
                  <TextInput
                    value={answer}
                    onChange={setAnswer}
                    autoComplete="off"
                    invalid={Boolean(fieldErrors.answer)}
                  />
                </Field>
              </>
            )}

            {phase === "login" && (
              <>
                <Field
                  label="البريد الإلكتروني أو اسم المستخدم"
                  required
                  error={fieldErrors.identifier}
                >
                  <TextInput
                    value={identifier}
                    onChange={setIdentifier}
                    dir="ltr"
                    autoComplete="username"
                    placeholder="owner@example.com"
                    invalid={Boolean(fieldErrors.identifier)}
                  />
                </Field>
                <Field
                  label="كلمة المرور"
                  required
                  error={fieldErrors.password}
                >
                  <PasswordInput
                    value={password}
                    onChange={setPassword}
                    autoComplete="current-password"
                    invalid={Boolean(fieldErrors.password)}
                  />
                </Field>
              </>
            )}

            {phase === "security" && (
              <>
                <div className="auth-question">
                  <Icons.help size={18} />
                  <div>
                    <small>سؤال الأمان الخاص بحسابك</small>
                    <strong>{currentQuestion}</strong>
                  </div>
                </div>
                <Field
                  label="الإجابة"
                  required
                  hint="لا تظهر الإجابة على الشاشة أبدًا."
                  error={fieldErrors.answer}
                >
                  <TextInput
                    value={answer}
                    onChange={setAnswer}
                    autoComplete="off"
                    placeholder="اكتب إجابتك"
                    invalid={Boolean(fieldErrors.answer)}
                  />
                </Field>
              </>
            )}

            {error && (
              <p className="auth-error" role="alert">
                <Icons.error size={16} />
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={busy}
              icon={
                phase === "security" ? (
                  <Icons.shield size={18} />
                ) : (
                  <Icons.arrowUpLeft size={18} />
                )
              }
            >
              {phase === "setup"
                ? "إنشاء الحساب"
                : phase === "complete"
                  ? "حفظ ومتابعة"
                  : phase === "security"
                    ? "تأكيد الدخول"
                    : "دخول لوحة التحكم"}
            </Button>

            {phase === "login" && (
              <p className="auth-hint auth-hint--center">
                لا توجد استعادة للكلمة عن طريق البريد — احتفظ بها في مكان آمن.
              </p>
            )}
            {phase === "security" && (
              <button
                type="button"
                className="auth-link"
                onClick={() => {
                  void adminApi.logout().catch(() => undefined);
                  setCsrfToken("");
                  setCurrentQuestion("");
                  setError("");
                  setPhase("login");
                  toast.push("info", "تم إلغاء الجلسة المعلّقة.");
                }}
              >
                لست أنت؟ العودة لتسجيل الدخول
              </button>
            )}
          </form>
        </div>
      </div>
      <p className="auth-foot">
        <Icons.shield size={14} />
        اتصال مشفّر · جلسة ٨ ساعات · حماية بصلاحيات
      </p>
    </div>
  );
}
