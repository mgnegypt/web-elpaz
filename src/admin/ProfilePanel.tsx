// Own-account panel (Owner and Admin see the same self-service screen).
// Split into tabs so no single screen is an endless scroll: account details,
// security (password + security question) and the current session.
// Nothing here can reach another account.
import { useEffect, useRef, useState } from "react";
import { adminApi, type AdminProfile } from "./api";
import { sessionAge, shortDateTime } from "./dates";
import { Icons } from "./icons";
import {
  Badge,
  Button,
  Drawer,
  Field,
  FormSection,
  ImagePreview,
  MetaRow,
  Notice,
  PasswordInput,
  SkeletonRows,
  Tabs,
  TabPanel,
  TextInput,
  describeError,
  fieldErrorsOf,
  useToast,
} from "./ui";

type TabKey = "account" | "security" | "session";

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
  const [tab, setTab] = useState<TabKey>("account");
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

  // The session age is a live value: refresh it every half minute.
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

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
      toast.push(
        "success",
        "تم تغيير كلمة المرور. الجلسات الأخرى على أجهزة أخرى أُغُلقت.",
      );
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

  const roleLabel = profile?.role === "owner" ? "المالك" : "مشرف";

  return (
    <Drawer
      open
      width="lg"
      title="الملف الشخصي"
      description={profile ? `${roleLabel} · ${profile.username}` : "…"}
      closeLabel="إغلاق الملف الشخصي"
      onClose={onClose}
      footer={
        <Button
          variant="danger"
          block
          icon={<Icons.logout size={17} />}
          onClick={onLogout}
        >
          تسجيل الخروج
        </Button>
      }
    >
      {!profile ? (
        <SkeletonRows rows={4} height={58} />
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
              <Badge
                tone={profile.role === "owner" ? "green" : "blue"}
                icon={
                  profile.role === "owner" ? (
                    <Icons.shield size={13} />
                  ) : (
                    <Icons.userCog size={13} />
                  )
                }
              >
                {roleLabel}
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

          <Tabs
            label="أقسام الملف الشخصي"
            value={tab}
            onChange={(key) => setTab(key as TabKey)}
            items={[
              {
                key: "account",
                label: "معلومات الحساب",
                icon: <Icons.userCog size={16} />,
              },
              {
                key: "security",
                label: "الأمان",
                icon: <Icons.shield size={16} />,
              },
              {
                key: "session",
                label: "الجلسة الحالية",
                icon: <Icons.clock size={16} />,
              },
            ]}
          />

          <TabPanel tabKey="account" active={tab === "account"}>
            <FormSection
              icon={<Icons.userCog size={17} />}
              title="معلومات الحساب"
              description="الاسم والبريد اللذان يظهران لك داخل اللوحة."
            >
              <Field label="الاسم الظاهر" error={errors.displayName}>
                <TextInput
                  value={displayName}
                  onChange={setDisplayName}
                  maxLength={80}
                  invalid={Boolean(errors.displayName)}
                />
              </Field>
              <Field
                label="البريد الإلكتروني"
                hint="يُستخدم لتسجيل الدخول."
                error={errors.email}
              >
                <TextInput
                  value={email}
                  onChange={setEmail}
                  type="email"
                  dir="ltr"
                  invalid={Boolean(errors.email)}
                />
              </Field>
              <Field
                label="رابط الصورة الشخصية"
                hint="يُملأ تلقائيًا عند رفع صورة. اتركه فارغًا لعرض الحرف الأول."
                error={errors.avatarUrl}
              >
                <TextInput
                  value={avatarUrl}
                  onChange={setAvatarUrl}
                  dir="ltr"
                  placeholder="/uploads/…"
                  invalid={Boolean(errors.avatarUrl)}
                />
              </Field>
              <div className="form-actions">
                <Button
                  icon={<Icons.save size={16} />}
                  loading={savingInfo}
                  onClick={() => void saveInfo()}
                >
                  حفظ البيانات
                </Button>
              </div>
            </FormSection>
          </TabPanel>

          <TabPanel tabKey="security" active={tab === "security"}>
            <FormSection
              icon={<Icons.key size={17} />}
              title="كلمة المرور"
              description="تغيير كلمة المرور يُغلق جلساتك على الأجهزة الأخرى فورًا."
            >
              <Field
                label="كلمة المرور الحالية"
                required
                error={errors.currentPassword}
              >
                <PasswordInput
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  autoComplete="current-password"
                  invalid={Boolean(errors.currentPassword)}
                />
              </Field>
              <Field
                label="كلمة المرور الجديدة"
                required
                hint="١٢ حرفًا على الأقل مع حروف وأرقام."
                error={errors.newPassword}
              >
                <PasswordInput
                  value={newPassword}
                  onChange={setNewPassword}
                  autoComplete="new-password"
                  invalid={Boolean(errors.newPassword)}
                />
              </Field>
              <div className="form-actions">
                <Button
                  variant="soft"
                  icon={<Icons.lock size={16} />}
                  loading={savingPassword}
                  disabled={!currentPassword || !newPassword}
                  onClick={() => void savePassword()}
                >
                  تغيير كلمة المرور
                </Button>
              </div>
            </FormSection>

            <FormSection
              icon={<Icons.shield size={17} />}
              title="سؤال الأمان"
              description="يُطلب بعد كلمة المرور عند الدخول. تغيير سؤال موجود يتطلّب تأكيد الإجابة الحالية."
            >
              {profile.hasSecurityQuestion && (
                <Field
                  label="الإجابة الحالية"
                  required
                  error={errors.currentAnswer}
                >
                  <TextInput
                    value={currentAnswer}
                    onChange={setCurrentAnswer}
                    autoComplete="off"
                    invalid={Boolean(errors.currentAnswer)}
                  />
                </Field>
              )}
              <Field label="السؤال" required error={errors.securityQuestion}>
                <TextInput
                  value={question}
                  onChange={setQuestion}
                  maxLength={160}
                  invalid={Boolean(errors.securityQuestion)}
                />
              </Field>
              <Field
                label="الإجابة الجديدة"
                required
                hint="تُخزَّن مشفّرة ولا تظهر في أي شاشة."
                error={errors.securityAnswer}
              >
                <TextInput
                  value={answer}
                  onChange={setAnswer}
                  autoComplete="off"
                  invalid={Boolean(errors.securityAnswer)}
                />
              </Field>
              <div className="form-actions">
                <Button
                  variant="soft"
                  icon={<Icons.shield size={16} />}
                  loading={savingSecurity}
                  disabled={!question.trim() || !answer.trim()}
                  onClick={() => void saveSecurity()}
                >
                  حفظ سؤال الأمان
                </Button>
              </div>
            </FormSection>
          </TabPanel>

          <TabPanel tabKey="session" active={tab === "session"}>
            <FormSection
              icon={<Icons.clock size={17} />}
              title="الجلسة الحالية"
              description="بيانات الجهاز الذي تستخدمه الآن."
            >
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
            </FormSection>

            <FormSection
              icon={<Icons.settings size={17} />}
              title="إجراءات الحساب"
              description="إجراءات تخص حسابك أنت فقط."
            >
              <MetaRow label="الصلاحية">{roleLabel}</MetaRow>
              <MetaRow label="اسم المستخدم">
                <span dir="ltr">{profile.username}</span>
              </MetaRow>
              <Notice tone="info" icon={<Icons.info size={16} />}>
                زر «تسجيل الخروج» في أسفل اللوحة ينهي هذه الجلسة على هذا الجهاز
                فقط. لتغيير كلمة المرور أو سؤال الأمان استخدم تبويب «الأمان».
              </Notice>
            </FormSection>
          </TabPanel>
        </>
      )}
    </Drawer>
  );
}
