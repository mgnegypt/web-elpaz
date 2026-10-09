// Dashboard shell: bootstrap → auth → application chrome (sidebar + top bar).
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ContentDoc } from "../../shared/content.ts";
import {
  ApiFailure,
  adminApi,
  setCsrfToken,
  subscribeLive,
  type AdminSession,
} from "./api";
import { Icons } from "./icons";
import { Skeleton, ToastProvider, useToast } from "./ui";
import AuthScreen from "./AuthScreen";
import OverviewPanel from "./OverviewPanel";
import ProductsPanel from "./ProductsPanel";
import ContentPanel from "./ContentPanel";
import EventsPanel from "./EventsPanel";
import RequestsPanel from "./RequestsPanel";
import AdminsPanel from "./AdminsPanel";
import AuditPanel from "./AuditPanel";
import ProfilePanel from "./ProfilePanel";
import ThemeToggle from "../components/ThemeToggle";

type Stage = "boot" | "auth" | "app";
type AuthStart = {
  phase: "setup" | "login" | "complete" | "security";
  question?: string;
};

const NAV = [
  { key: "overview", label: "نظرة عامة", icon: "dashboard" },
  { key: "products", label: "المنتجات", icon: "package" },
  { key: "events", label: "المناسبات", icon: "events" },
  { key: "content", label: "محتوى الموقع", icon: "palette" },
  { key: "requests", label: "طلبات الجملة", icon: "truck" },
] as const;

const OWNER_NAV = [
  { key: "admins", label: "حسابات المشرفين", icon: "users" },
  { key: "audit", label: "سجل النشاط", icon: "activity" },
] as const;

const RAIL_KEY = "elbaz-admin-rail";

function Dashboard() {
  const toast = useToast();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [content, setContent] = useState<ContentDoc | null>(null);
  const [tab, setTab] = useState<string>("overview");
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useState(false);
  const [contentDirty, setContentDirty] = useState(false);
  const [staleRevision, setStaleRevision] = useState<number | null>(null);
  // Desktop rail: a narrower sidebar that still shows a label under each icon.
  const [rail, setRail] = useState(
    () => localStorage.getItem(RAIL_KEY) === "1",
  );
  const dirtyRef = useRef(false);
  const mainRef = useRef<HTMLElement>(null);

  const sessionRef = useRef<AdminSession | null>(null);
  sessionRef.current = session;

  const loadContent = useCallback(async () => {
    setStaleRevision(null);
    const document_ = await adminApi.content();
    setContent(document_);
    return document_;
  }, []);

  useEffect(() => {
    dirtyRef.current = contentDirty;
  }, [contentDirty]);

  useEffect(() => {
    localStorage.setItem(RAIL_KEY, rail ? "1" : "0");
  }, [rail]);

  // Escape closes the off-canvas menu wherever focus happens to be.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const [stage, setStage] = useState<Stage>("boot");
  const [start, setStart] = useState<AuthStart>({ phase: "login" });

  /** Reads the setup status, retrying transient failures (e.g. a cold API). */
  const readStatus = async (attempts: number) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await adminApi.status();
      } catch {
        await new Promise((resolve) =>
          window.setTimeout(resolve, 600 * (attempt + 1)),
        );
      }
    }
    return null;
  };

  /* ------------------------------------------------------------- bootstrap */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const current = await adminApi.session();
        if (!live) return;
        if (!current.authenticated) {
          // The security question is still pending on this session.
          setCsrfToken(current.csrf);
          setStart({ phase: "security", question: current.question });
          setStage("auth");
          return;
        }
        setCsrfToken(current.csrf);
        setSession(current);
        await loadContent();
        if (live) setStage("app");
      } catch (failure) {
        if (!live) return;
        // A 401 is the normal "not signed in yet" answer; anything else may just
        // be the API still waking up, so retry before assuming anything.
        const unauthorised =
          failure instanceof ApiFailure && failure.status === 401;
        const status = await readStatus(unauthorised ? 2 : 5);
        if (!live) return;
        // Resolve the phase first, then mount the auth screen: it must never
        // appear as the login form when the site actually needs first-run setup.
        setStart({ phase: status?.needsSetup ? "setup" : "login" });
        setStage("auth");
      }
    })();
    return () => {
      live = false;
    };
  }, [loadContent]);

  /* ------------------------------------------------------------ live feed */
  useEffect(() => {
    if (stage !== "app") return;
    const stop = subscribeLive((type) => {
      if (type === "events") return;
      if (dirtyRef.current) {
        setStaleRevision((current) => current ?? -1);
        return;
      }
      void adminApi
        .content()
        .then((document_) => {
          setContent(document_);
          if (type === "content")
            toast.push("info", "تم تحديث المحتوى من مصدر آخر.");
        })
        .catch(() => undefined);
    }, setOnline);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const logout = useCallback(async () => {
    try {
      await adminApi.logout();
    } catch {
      /* the cookie is cleared server-side either way */
    }
    setCsrfToken("");
    setSession(null);
    setContent(null);
    setProfileOpen(false);
    setStage("auth");
    setStart({ phase: "login" });
    toast.push("info", "تم تسجيل الخروج.");
  }, [toast]);

  const goTo = (next: string) => {
    setMenuOpen(false);
    if (next === "profile") {
      setProfileOpen(true);
      return;
    }
    setTab(next);
    // Keyboard and screen-reader users land on the new panel, not where the
    // old one used to be.
    requestAnimationFrame(() => {
      // `focus()` would scroll the panel under the sticky top bar; move the
      // window to the top ourselves instead.
      mainRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, left: 0 });
    });
  };

  /** A 401 anywhere means the session died: return to the login screen. */
  const guard = useCallback(
    (failure: unknown) => {
      if (failure instanceof ApiFailure && failure.status === 401)
        void logout();
      return failure;
    },
    [logout],
  );

  const navItems = useMemo(() => {
    const items = [...NAV] as {
      key: string;
      label: string;
      icon: keyof typeof Icons;
    }[];
    if (session?.capabilities.manageAdmins)
      items.push(...(OWNER_NAV as unknown as typeof items));
    return items;
  }, [session?.capabilities.manageAdmins]);

  if (stage === "boot") {
    return (
      <div className="admin-boot dash">
        <div className="boot-brand">
          <span className="boot-mark">
            <Icons.brand size={24} />
          </span>
          <div>
            <strong>البان إلباظ</strong>
            <span>لوحة التحكم</span>
          </div>
        </div>
        <div className="boot-cards">
          {[0, 1, 2].map((index) => (
            <div className="skeleton-card" key={index}>
              <Skeleton width="45%" height={16} />
              <Skeleton width="85%" height={12} />
              <Skeleton width="65%" height={12} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (stage === "auth" || !session || !content) {
    return (
      <AuthScreen
        initialPhase={start.phase}
        initialQuestion={start.question}
        onSuccess={async (next) => {
          setSession(next);
          try {
            await loadContent();
          } catch (failure) {
            guard(failure);
          }
          setStage("app");
        }}
      />
    );
  }

  const activeLabel =
    [...NAV, ...OWNER_NAV].find((item) => item.key === tab)?.label ?? "";
  const ownerNavKeys = OWNER_NAV.map((item) => item.key) as string[];

  return (
    <div className="admin-shell dash" data-rail={rail ? "true" : "false"}>
      <a className="skip-link" href="#admin-main">
        تخطّي إلى محتوى الصفحة
      </a>

      <aside
        id="admin-sidebar"
        className={`sidebar${menuOpen ? " sidebar--open" : ""}`}
      >
        <div className="sidebar-head">
          <span className="sidebar-brand">
            <span className="sidebar-mark">
              <Icons.brand size={21} />
            </span>
            <span className="sidebar-brand-text">
              <strong>البان إلباظ</strong>
              <span>لوحة التحكم</span>
            </span>
          </span>
          <span className="sidebar-head-tools">
            <button
              type="button"
              className="icon-btn icon-btn--ghost sidebar-rail-toggle"
              onClick={() => setRail((value) => !value)}
              aria-label={rail ? "توسيع القائمة الجانبية" : "تصغير القائمة الجانبية"}
              title={rail ? "توسيع القائمة الجانبية" : "تصغير القائمة الجانبية"}
              aria-pressed={rail}
            >
              {rail ? <Icons.railOpen size={18} /> : <Icons.railClose size={18} />}
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--ghost sidebar-close"
              onClick={() => setMenuOpen(false)}
              aria-label="طيّ القائمة"
            >
              <Icons.close size={18} />
            </button>
          </span>
        </div>

        <nav className="sidebar-nav" aria-label="أقسام اللوحة">
          <p className="nav-section">إدارة الموقع</p>
          {navItems.map((item, index) => {
            const Icon = Icons[item.icon];
            const ownerSection =
              ownerNavKeys.includes(item.key) &&
              !ownerNavKeys.includes(navItems[index - 1]?.key ?? "");
            return (
              <Fragment key={item.key}>
                {ownerSection && <p className="nav-section">صلاحيات المالك</p>}
                <button
                  type="button"
                  className={`nav-item${tab === item.key ? " nav-item--active" : ""}`}
                  onClick={() => goTo(item.key)}
                  aria-current={tab === item.key ? "page" : undefined}
                >
                  <Icon size={19} />
                  <span className="nav-item-label">{item.label}</span>
                </button>
              </Fragment>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <button
            type="button"
            className="nav-item"
            onClick={() => {
              setMenuOpen(false);
              setProfileOpen(true);
            }}
          >
            <Icons.user size={19} />
            <span className="nav-item-label">الملف الشخصي</span>
          </button>
          <button
            type="button"
            className="nav-item nav-item--danger"
            onClick={() => void logout()}
          >
            <Icons.logout size={19} />
            <span className="nav-item-label">تسجيل الخروج</span>
          </button>
          <p className="sidebar-note">
            <Icons.shield size={13} />
            {session.role === "owner" ? "صلاحية المالك" : "صلاحية مشرف"}
          </p>
        </div>
      </aside>

      {/* Pointer users dismiss the menu by tapping outside; keyboard users press
          Escape or use the close control inside the panel. */}
      {menuOpen && (
        <div
          className="sidebar-scrim"
          aria-hidden="true"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div className="admin-body">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn icon-btn--outline topbar-menu"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="فتح القائمة"
            aria-expanded={menuOpen}
            aria-controls="admin-sidebar"
          >
            <Icons.menu size={20} />
          </button>
          <div className="topbar-title">
            {/* The panel below renders the page <h1>; this is only a locator hint. */}
            <span className="topbar-label">{activeLabel}</span>
            <span className={`live-chip${online ? " live-chip--on" : ""}`}>
              {online ? (
                <Icons.online size={13} />
              ) : (
                <Icons.offline size={13} />
              )}
              {online ? "تحديث فوري" : "غير متصل"}
            </span>
          </div>
          <div className="topbar-actions">
            {staleRevision !== null && (
              <button
                type="button"
                className="stale-chip"
                onClick={() => {
                  void adminApi.content().then((document_) => {
                    setContent(document_);
                    setStaleRevision(null);
                  });
                }}
              >
                <Icons.refresh size={14} />
                نسخة أحدث على السيرفر — تحديث
              </button>
            )}
            <ThemeToggle />
            <button
              type="button"
              className="profile-chip"
              onClick={() => setProfileOpen(true)}
              aria-label={`الملف الشخصي — ${session.displayName}`}
            >
              {session.avatarUrl ? (
                <img src={session.avatarUrl} alt="" />
              ) : (
                <span className="avatar-fallback avatar-fallback--sm">
                  {session.displayName.trim().charAt(0) || "؟"}
                </span>
              )}
              <span className="profile-chip-text">
                <strong>{session.displayName}</strong>
                <small>{session.role === "owner" ? "مالك" : "مشرف"}</small>
              </span>
            </button>
          </div>
        </header>

        <main className="admin-main" id="admin-main" ref={mainRef} tabIndex={-1}>
          {/* `key` restarts the enter animation on every section change. */}
          <div className="panel" key={tab}>
            {tab === "overview" && (
              <OverviewPanel
                session={session}
                content={content}
                online={online}
                onNavigate={goTo}
              />
            )}
            {tab === "products" && (
              <ProductsPanel
                content={content}
                onContent={setContent}
                categories={content.categories}
              />
            )}
            {tab === "events" && <EventsPanel />}
            {tab === "content" && (
              <ContentPanel
                content={content}
                onContent={setContent}
                onDirtyChange={setContentDirty}
              />
            )}
            {tab === "requests" && <RequestsPanel />}
            {tab === "admins" && session.capabilities.manageAdmins && (
              <AdminsPanel selfId={session.id} />
            )}
            {tab === "admins" && !session.capabilities.manageAdmins && (
              <div className="card">
                <div className="card-body">
                  <p className="confirm-text">هذه الصفحة متاحة للمالك فقط.</p>
                </div>
              </div>
            )}
            {tab === "audit" && session.capabilities.manageAdmins && (
              <AuditPanel />
            )}
          </div>
        </main>
      </div>

      {profileOpen && (
        <ProfilePanel
          onClose={() => setProfileOpen(false)}
          onLogout={() => void logout()}
          onProfileChange={(profile) =>
            setSession((current) =>
              current
                ? {
                    ...current,
                    displayName: profile.displayName,
                    email: profile.email,
                    avatarUrl: profile.avatarUrl,
                    hasSecurityQuestion: profile.hasSecurityQuestion,
                  }
                : current,
            )
          }
        />
      )}
    </div>
  );
}

export default function AdminApp() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}
