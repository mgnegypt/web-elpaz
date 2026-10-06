import { useCallback, useEffect, useState } from "react";
import { Loader2, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import type { ContentDoc } from "../../shared/content.ts";
import { ApiFailure, adminApi, setCsrfToken } from "./api";
import RequestsPanel from "./RequestsPanel";
import ProductsPanel from "./ProductsPanel";
import ContentPanel from "./ContentPanel";
import ThemeToggle from "../components/ThemeToggle";

type Phase = "checking" | "setup" | "login" | "ready";

export default function AdminApp() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"requests" | "products" | "content">("requests");
  const [content, setContent] = useState<ContentDoc | null>(null);

  const loadContent = useCallback(async () => {
    const document_ = await adminApi.content();
    setContent(document_);
    return document_;
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const session = await adminApi.session();
        if (!live) return;
        setCsrfToken(session.csrf);
        setUsername(session.username);
        await loadContent();
        if (live) setPhase("ready");
      } catch {
        if (!live) return;
        try {
          const status = await adminApi.status();
          if (live) setPhase(status.needsSetup ? "setup" : "login");
        } catch {
          if (live) {
            setPhase("login");
            setError("تعذّر الاتصال بالسيرفر.");
          }
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [loadContent]);

  const authenticate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result =
        phase === "setup"
          ? await adminApi.setup(token.trim(), username.trim(), password)
          : await adminApi.login(username.trim(), password);
      setCsrfToken(result.csrf);
      setUsername(result.username);
      setPassword("");
      setToken("");
      await loadContent();
      setPhase("ready");
    } catch (failure) {
      const status = failure instanceof ApiFailure ? failure.status : 0;
      const code = (failure as Error).message;
      setError(
        code === "setup-already-complete"
          ? "تم إنشاء الحساب بالفعل. سجّل الدخول من فضلك."
          : code === "invalid-setup-token"
            ? "رمز الإعداد غير صحيح."
            : code === "invalid-credentials" || status === 401
              ? "اسم المستخدم أو كلمة المرور غير صحيحة."
              : status === 422
                ? "تأكد من صحة البيانات: كلمة المرور 12 حرفًا على الأقل."
                : "حدث خطأ، حاول مرة أخرى.",
      );
      if (code === "setup-already-complete") setPhase("login");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await adminApi.logout();
    } catch {
      /* the cookie is cleared server-side either way */
    }
    setCsrfToken("");
    setPhase("login");
    setContent(null);
  };

  if (phase === "checking") {
    return (
      <div className="admin-loading">
        <Loader2 className="spin" size={26} />
        جاري التحقق…
      </div>
    );
  }

  if (phase !== "ready") {
    return (
      <div className="admin-auth">
        <ThemeToggle />
        <form className="admin-auth-card" onSubmit={authenticate}>
          <span className="admin-badge">
            {phase === "setup" ? <ShieldCheck size={18} /> : <LockKeyhole size={18} />}
            {phase === "setup" ? "الإعداد الأول" : "دخول لوحة التحكم"}
          </span>
          <h1>{phase === "setup" ? "إنشاء حساب المدير" : "تسجيل الدخول"}</h1>
          {phase === "setup" ? (
            <p className="admin-note">
              اقرأ الرمز من الملف <code dir="ltr">.data/setup-token</code> على السيرفر.
              الرمز لمرة واحدة ويُحذف بعد إنشاء الحساب.
            </p>
          ) : (
            <p className="admin-note">لوحة تحكم البان إلباظ — للمشرفين فقط.</p>
          )}
          {phase === "setup" && (
            <label className="admin-field">
              <span>رمز الإعداد (64 حرفًا)</span>
              <input
                name="token"
                dir="ltr"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                required
              />
            </label>
          )}
          <label className="admin-field">
            <span>اسم المستخدم</span>
            <input
              name="username"
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="admin-field">
            <span>
              كلمة المرور {phase === "setup" && <small>(12 حرفًا على الأقل)</small>}
            </span>
            <input
              name="password"
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={phase === "setup" ? "new-password" : "current-password"}
              required
            />
          </label>
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          <button className="admin-primary" type="submit" disabled={busy}>
            {busy && <Loader2 className="spin" size={18} />}
            {phase === "setup" ? "إنشاء الحساب" : "دخول"}
          </button>
          {phase === "login" && (
            <p className="admin-hint">
              لا توجد استعادة لكلمة المرور عن طريق البريد. احتفظ بها في مكان آمن.
            </p>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand">
          <strong>البان إلباظ</strong>
          <span>لوحة التحكم</span>
        </div>
        <nav className="admin-tabs">
          {(
            [
              ["requests", "طلبات الجملة"],
              ["products", "المنتجات"],
              ["content", "محتوى الموقع"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
              aria-current={tab === key ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="admin-actions">
          <span className="admin-user">{username}</span>
          <ThemeToggle />
          <button className="admin-ghost" onClick={logout}>
            <LogOut size={16} />
            خروج
          </button>
        </div>
      </header>
      <main className="admin-main">
        {tab === "requests" && <RequestsPanel />}
        {tab === "products" && content && (
          <ProductsPanel content={content} onContent={setContent} />
        )}
        {tab === "content" && content && (
          <ContentPanel content={content} onContent={setContent} />
        )}
      </main>
    </div>
  );
}
