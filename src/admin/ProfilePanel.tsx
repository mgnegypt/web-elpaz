// Own-account panel (Owner and Admin see the same self-service screen).
// Close button at the top, log out at the bottom, nothing about other accounts.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { adminApi, type AdminProfile } from "./api";
import { sessionAge, shortDateTime } from "./dates";
import { Icons } from "./icons";
import {
  Badge,
  Button,
  Field,
  ImagePreview,
  Skeleton,
  TextInput,
  describeError,
  fieldErrorsOf,
  useToast,
} from "./ui";

/**
 * @param onClose         closes the panel (X at the top)
 * @param onLogout        provided by the shell; rendered at the bottom
 * @param onProfileChange keeps the header greeting/avatar in sync
 */
export default function ProfilePanel({
  onClose,
  onLogout,
  onProfileChange,
}: {
  onClose: () => void;
  onLogout: () => void;
  onProfileChange: (profile: AdminProfile) => void;
}) {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(Date.now());
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const result = await adminApi.profile();
        if (!live) return;
        setProfile(result);
        setDisplayName(result.displayName);
        setEmail(result.email);
        setAvatarUrl(result.avatarUrl);
        setQuestion(result.securityQuestion);
      } catch (failure) {
        toast.push("error", describeError(failure));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const uploadAvatar = async (file: File) => {
    setSavingInfo(true);
    try {
      const result = await adminApi.upload(file);
      setAvatarUrl(result.upload.url);
      const saved = await adminApi.updateProfile({
        displayName: displayName.trim(),
        email: email.trim(),
        avatarUrl: result.upload.url,
      });
      setProfile(saved.profile);
      onProfileChange(saved.profile);
      toast.push("success", "تم تحديث الصورة الشخصية.");
    } catch (failure) {
      toast.push("error", describeError(failure));
    } finally {
      setSavingInfo(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveInfo = async () => {
    setSavingInfo(true);
    setErrors({});
    try {
      const saved = await adminApi.updateProfile({
        displayName: displayName.trim(),
        email: email.trim(),
        avatarUrl: avatarUrl.trim(),
      });
      setProfile(saved.profile);
      onProfileChange(saved.profile);
      toast.push("success", "تم حفظ بيانات الحساب.");
    } catch (failure) {
      setErrors(fieldErrorsOf(failure));
      toast.push("error", describeError(failure));
    } finally {
      setSavingInfo(false);
    }
  };

  const savePassword = async () => {
    setSavingPassword(true);
    setErrors({});
    try {
      await adminApi.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      toast.push("success", "تم تغيير كلمة المرور. الجلسات الأخرى على أجهزة أخرى أُغُلقت.");
    } catch (failure) {
      setErrors(fieldErrorsOf(failure));
      toast.push("error", describeError(failure));
    } finally {
      setSavingPassword(false);
    }
  };

  const saveSecurity = async () => {
    setSavingSecurity(true);
    setErrors({});
    try {
      const saved = await adminApi.changeSecurity({
        securityQuestion: question.trim(),
        securityAnswer: answer.trim(),
        currentAnswer: currentAnswer.trim(),
      });
      setProfile(saved.profile);
      setAnswer("");
      setCurrentAnswer("");
      onProfileChange(saved.profile);
      toast.push("success", "تم تحديث سؤال الأمان.");
    } catch (failure) {
      setErrors(fieldErrorsOf(failure));
      toast.push("error", describeError(failure));
    } finally {
      setSavingSecurity(false);
    }
  };

  return createPortal(
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="الملف الشخصي">
        <header className="drawer-head">
          <div className="drawer-title">
            <Icons.user size={20} />
            <div>
              <h2>الملف الشخصي</h2>
              <p>{profile ? `${profile.role === "owner" ? "المالك" : "مشرف"} · ${profile.username}` : "…"}</p>
            </div>
          </div>
          <button className="icon-btn icon-btn--ghost" onClick={onClose} aria-label="إغلاق الملف الشخصي">
            <Icons.close size={20} />
          </button>
        </header>

        <div className="drawer-body">
          {!profile ? (
            <div className="skeleton-lines">
              <Skeleton height={92} radius={16} />
              <Skeleton height={46} radius={12} />
              <Skeleton height={46} radius={12} />
              <Skeleton height={46} radius={12} />
            </div>
          ) : (
            <>
              <div className="profile-identity">
                {avatarUrl ? (
                  <ImagePreview url={avatarUrl} alt={profile.displayName} />
                ) : (
                  <span className="avatar-fallback" aria-hidden="true">
                    {profile.displayName.trim().charAt(0) || "؟"}
                  </span>
                )}
                <div className="profile-identity-text">
                  <strong>{profile.displayName}</strong>
                  <span dir="ltr">{profile.email || "—"}</span>
                  <Badge tone={profile.role === "owner" ? "green" : "blue"}>
                    {profile.role === "owner" ? "المالك" : "مشرف"}
                  </Badge>
                </div>
                <div className="profile-avatar-actions">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="visually-hidden"
                    id="avatar-upload"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadAvatar(file);
                    }}
                  />
                  <Button
                    variant="soft"
                    size="sm"
                    icon={<Icons.upload size={15} />}
                    loading={savingInfo}
                    onClick={() => fileRef.current?.click()}
                  >
                    تغيير الصورة
                  </Button>
                  {avatarUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Icons.trash size={15} />}
                      onClick={() => setAvatarUrl("")}
                    >
                      إزالة
                    </Button>
                  )}
                </div>
              </div>

              <section className="drawer-section">
                <h3>
                  <Icons.userCog size={17} />
                  بيانات الحساب
                </h3>
                <Field label="الاسم الظاهر" error={errors.displayName}>
                  <TextInput value={displayName} onChange={setDisplayName} maxLength={80} />
                </Field>
                <Field label="البريد الإلكتروني" hint="يُستخدم لتسجيل الدخول." error={errors.email}>
                  <TextInput value={email} onChange={setEmail} type="email" dir="ltr" />
                </Field>
                <Field label="رابط الصورة الشخصية" error={errors.avatarUrl}>
                  <TextInput value={avatarUrl} onChange={setAvatarUrl} dir="ltr" placeholder="/uploads/…" />
                </Field>
                <Button icon={<Icons.save size={16} />} loading={savingInfo} onClick={() => void saveInfo()}>
                  حفظ البيانات
                </Button>
              </section>

              <section className="drawer-section">
                <h3>
                  <Icons.key size={17} />
                  كلمة المرور
                </h3>
                <Field label="كلمة المرور الحالية" required error={errors.currentPassword}>
                  <TextInput value={currentPassword} onChange={setCurrentPassword} type="password" dir="ltr" autoComplete="current-password" />
                </Field>
                <Field
                  label="كلمة المرور الجديدة"
                  required
                  hint="١٢ حرفًا على الأقل مع حروف وأرقام."
                  error={errors.newPassword}
                >
                  <TextInput value={newPassword} onChange={setNewPassword} type="password" dir="ltr" autoComplete="new-password" />
                </Field>
                <Button
                  variant="soft"
                  icon={<Icons.lock size={16} />}
                  loading={savingPassword}
                  disabled={!currentPassword || !newPassword}
                  onClick={() => void savePassword()}
                >
                  تغيير كلمة المرور
                </Button>
              </section>

              <section className="drawer-section">
                <h3>
                  <Icons.shield size={17} />
                  سؤال الأمان
                </h3>
                <p className="drawer-note">
                  يُطلب بعد كلمة المرور عند الدخول. تغيير سؤال موجود يتطلّب تأكيد الإجابة الحالية.
                </p>
                {profile.hasSecurityQuestion && (
                  <Field label="الإجابة الحالية" required error={errors.currentAnswer}>
                    <TextInput value={currentAnswer} onChange={setCurrentAnswer} autoComplete="off" />
                  </Field>
                )}
                <Field label="السؤال" required error={errors.securityQuestion}>
                  <TextInput value={question} onChange={setQuestion} maxLength={160} />
                </Field>
                <Field
                  label="الإجابة الجديدة"
                  required
                  hint="تُخزَّن مشفّرة ولا تظهر في أي شاشة."
                  error={errors.securityAnswer}
                >
                  <TextInput value={answer} onChange={setAnswer} autoComplete="off" />
                </Field>
                <Button
                  variant="soft"
                  icon={<Icons.shield size={16} />}
                  loading={savingSecurity}
                  disabled={!question.trim() || !answer.trim()}
                  onClick={() => void saveSecurity()}
                >
                  حفظ سؤال الأمان
                </Button>
              </section>

              <section className="drawer-section">
                <h3>
                  <Icons.clock size={17} />
                  معلومات الجلسة
                </h3>
                <dl className="session-grid">
                  <div>
                    <dt>مدة الجلسة الحالية</dt>
                    <dd>{sessionAge(profile.session.createdAt, new Date(tick))}</dd>
                  </div>
                  <div>
                    <dt>بدأت في</dt>
                    <dd>{shortDateTime(profile.session.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>تنتهي في</dt>
                    <dd>{shortDateTime(profile.session.expiresAt)}</dd>
                  </div>
                  <div>
                    <dt>آخر دخول</dt>
                    <dd>{shortDateTime(profile.lastLoginAt)}</dd>
                  </div>
                  <div>
                    <dt>عنوان IP</dt>
                    <dd dir="ltr">{profile.session.ip || "—"}</dd>
                  </div>
                  <div>
                    <dt>المتصفح</dt>
                    <dd className="session-ua" dir="ltr">
                      {profile.session.userAgent || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>التحقق الإضافي</dt>
                    <dd>
                      {profile.session.securityVerified ? (
                        <Badge tone="green" icon={<Icons.check size={13} />}>
                          تم
                        </Badge>
                      ) : (
                        <Badge tone="amber">بانتظار الإجابة</Badge>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>تاريخ الإنشاء</dt>
                    <dd>{shortDateTime(profile.createdAt)}</dd>
                  </div>
                </dl>
              </section>
            </>
          )}
        </div>

        <footer className="drawer-foot">
          <Button variant="danger" block icon={<Icons.logout size={17} />} onClick={onLogout}>
            تسجيل الخروج
          </Button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
