// Owner-only account management. The whole panel is only mounted for the Owner,
// and every request it makes is re-checked on the server.
import { useEffect, useState } from "react";
import type { Role } from "../../shared/content.ts";
import { adminApi, type AdminAccount } from "./api";
import { shortDateTime } from "./dates";
import { Icons } from "./icons";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Grid,
  Modal,
  OptionGroup,
  PageHeader,
  Select,
  Skeleton,
  TextInput,
  describeError,
  fieldErrorsOf,
  useToast,
} from "./ui";
import { StatPill } from "./ProductsPanel";

type Draft = {
  id: number | null;
  username: string;
  displayName: string;
  email: string;
  password: string;
  role: Role;
};

const emptyDraft = (): Draft => ({
  id: null,
  username: "",
  displayName: "",
  email: "",
  password: "",
  role: "admin",
});

export default function AdminsPanel({ selfId }: { selfId: number }) {
  const [items, setItems] = useState<AdminAccount[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<AdminAccount | null>(null);
  const toast = useToast();

  const load = async () => {
    try {
      const result = await adminApi.admins();
      setItems(result.items);
    } catch (failure) {
      toast.push("error", describeError(failure));
      setItems([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErrors({});
    try {
      if (draft.id === null) {
        const result = await adminApi.createAdmin({
          username: draft.username.trim(),
          displayName: draft.displayName.trim() || draft.username.trim(),
          email: draft.email.trim(),
          password: draft.password,
          role: draft.role,
        });
        setItems((current) => [...(current ?? []), result.admin]);
        toast.push("success", "تم إنشاء الحساب. يمكنه تسجيل الدخول فورًا.");
      } else {
        const result = await adminApi.updateAdmin(draft.id, {
          username: draft.username.trim(),
          displayName: draft.displayName.trim() || draft.username.trim(),
          email: draft.email.trim(),
          avatarUrl: "",
          role: draft.role,
          ...(draft.password ? { password: draft.password } : {}),
        });
        setItems((current) => (current ?? []).map((item) => (item.id === result.admin.id ? result.admin : item)));
        toast.push("success", draft.password ? "تم حفظ البيانات وإلغاء جلسات هذا الحساب." : "تم حفظ بيانات الحساب.");
      }
      setDraft(null);
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      setErrors(fields);
      if (!Object.keys(fields).length) toast.push("error", describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await adminApi.deleteAdmin(pendingDelete.id);
      setItems((current) => (current ?? []).filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
      toast.push("success", "تم حذف الحساب.");
    } catch (failure) {
      toast.push("error", describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  const owners = (items ?? []).filter((item) => item.role === "owner").length;

  return (
    <>
      <PageHeader
        title="حسابات المشرفين"
        description="صلاحية المالك فقط: إضافة حساب مشرف وتعديله وحذفه. لا تظهر هذه الصفحة للمشرفين إطلاقًا، وكل طلب من مشرف يُرفض على السيرفر."
        actions={
          <Button icon={<Icons.userPlus size={17} />} onClick={() => setDraft(emptyDraft())}>
            حساب مشرف جديد
          </Button>
        }
      />

      <div className="stat-row">
        <StatPill label="الحسابات" value={items?.length ?? 0} tone="blue" icon={<Icons.users size={16} />} />
        <StatPill label="حسابات المالك" value={owners} tone="green" icon={<Icons.shield size={16} />} />
        <StatPill label="مشرفون" value={(items?.length ?? 0) - owners} tone="violet" icon={<Icons.userCog size={16} />} />
      </div>

      <Card title="الحسابات" icon={<Icons.users size={18} />}>
        {items === null ? (
          <div className="skeleton-lines">
            <Skeleton height={48} radius={12} />
            <Skeleton height={48} radius={12} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="لا توجد حسابات" icon={<Icons.users size={28} />} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>اسم المستخدم</th>
                  <th>البريد الإلكتروني</th>
                  <th>الصلاحية</th>
                  <th>سؤال الأمان</th>
                  <th>آخر دخول</th>
                  <th aria-label="إجراءات" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="الاسم">
                      <span className="cell-strong">{item.displayName}</span>
                      {item.id === selfId && <Badge tone="blue">أنت</Badge>}
                    </td>
                    <td data-label="اسم المستخدم" dir="ltr">
                      {item.username}
                    </td>
                    <td data-label="البريد" dir="ltr">
                      {item.email || "—"}
                    </td>
                    <td data-label="الصلاحية">
                      <Badge tone={item.role === "owner" ? "green" : "violet"}>
                        {item.role === "owner" ? "مالك" : "مشرف"}
                      </Badge>
                    </td>
                    <td data-label="سؤال الأمان">{item.hasSecurityQuestion ? "مُعد" : "غير مُعد"}</td>
                    <td data-label="آخر دخول">{item.lastLoginAt ? shortDateTime(item.lastLoginAt) : "لم يدخل بعد"}</td>
                    <td data-label="إجراءات">
                      <div className="row-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Icons.pencil size={15} />}
                          onClick={() =>
                            setDraft({
                              id: item.id,
                              username: item.username,
                              displayName: item.displayName,
                              email: item.email,
                              password: "",
                              role: item.role,
                            })
                          }
                        >
                          تعديل
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Icons.trash size={15} />}
                          disabled={item.id === selfId}
                          title={item.id === selfId ? "لا يمكنك حذف حسابك" : "حذف"}
                          onClick={() => setPendingDelete(item)}
                        >
                          حذف
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={draft !== null}
        title={draft?.id === null ? "حساب مشرف جديد" : `تعديل: ${draft?.displayName || ""}`}
        description="المشرف يدير الموقع والمنتجات والطلبات، لكنه لا يرى حسابات الآخرين ولا إعدادات أمان المالك."
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              إلغاء
            </Button>
            <Button icon={<Icons.save size={17} />} loading={busy} onClick={() => void save()}>
              حفظ
            </Button>
          </>
        }
      >
        {draft && (
          <>
            <Grid columns={2}>
              <Field label="اسم المستخدم" required error={errors.username}>
                <TextInput value={draft.username} onChange={(username) => setDraft({ ...draft, username })} dir="ltr" maxLength={40} />
              </Field>
              <Field label="الاسم الظاهر" error={errors.displayName}>
                <TextInput value={draft.displayName} onChange={(displayName) => setDraft({ ...draft, displayName })} maxLength={80} />
              </Field>
            </Grid>
            <Field label="البريد الإلكتروني" required hint="يُستخدم لتسجيل الدخول." error={errors.email}>
              <TextInput value={draft.email} onChange={(email) => setDraft({ ...draft, email })} type="email" dir="ltr" />
            </Field>
            <Field
              label={draft.id === null ? "كلمة المرور" : "كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)"}
              required={draft.id === null}
              hint="١٢ حرفًا على الأقل."
              error={errors.password}
            >
              <TextInput value={draft.password} onChange={(password) => setDraft({ ...draft, password })} type="password" dir="ltr" autoComplete="new-password" />
            </Field>
            <Field label="الصلاحية" required>
              <OptionGroup<Role>
                value={draft.role}
                onChange={(role) => setDraft({ ...draft, role })}
                options={[
                  { value: "admin", label: "مشرف", hint: "يدير الموقع بدون صلاحيات الحسابات", icon: <Icons.userCog size={16} /> },
                  { value: "owner", label: "مالك", hint: "كل الصلاحيات بما فيها إدارة الحسابات", icon: <Icons.shield size={16} /> },
                ]}
              />
            </Field>
            {draft.id === selfId && draft.role !== "owner" && (
              <p className="field-hint">
                <Icons.info size={14} /> لا يمكن تحويل آخر حساب مالك إلى مشرف.
              </p>
            )}
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="حذف الحساب"
        message={`سيُحذف حساب «${pendingDelete?.displayName ?? ""}» وتُلغى جلساته فورًا.`}
        confirmLabel="حذف الحساب"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

export const ROLE_LABELS: Record<Role, string> = { owner: "مالك", admin: "مشرف" };

/** Select helper kept exported for reuse in tests/tools. */
export const roleSelectOptions = (Object.keys(ROLE_LABELS) as Role[]).map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export { Select as RoleSelect };
