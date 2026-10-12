// Wholesale requests: everything the site's order form collected, with the
// status each request is in. Read, filter, update status, delete.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  type RequestStatus,
} from "../../shared/content.ts";
import { adminApi, type AdminRequest, type RequestsPage } from "./api";
import { shortDateTime } from "./dates";
import { Icons } from "./icons";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  Pagination,
  SearchInput,
  SegmentedControl,
  SkeletonRows,
  StatPill,
  TableWrap,
  Toolbar,
  describeError,
  useToast,
} from "./ui";

const STATUS_TONE: Record<RequestStatus, "amber" | "blue" | "green" | "neutral"> = {
  new: "amber",
  contacted: "blue",
  confirmed: "green",
  archived: "neutral",
};

export default function RequestsPanel() {
  const [data, setData] = useState<RequestsPage | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AdminRequest | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await adminApi.requests({ search, status, page }));
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const counts = useMemo(() => {
    const items = data?.items ?? [];
    return {
      total: data?.total ?? 0,
      fresh: items.filter((item) => item.status === "new").length,
      confirmed: items.filter((item) => item.status === "confirmed").length,
    };
  }, [data]);

  const change = async (id: number, next: RequestStatus) => {
    try {
      const result = await adminApi.setRequestStatus(id, next);
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === id ? result.request : item,
              ),
            }
          : current,
      );
      toast.push("success", "تم تحديث حالة الطلب.");
    } catch (failure) {
      toast.push("error", describeError(failure));
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await adminApi.deleteRequest(pendingDelete.id);
      setPendingDelete(null);
      toast.push("success", "تم حذف الطلب.");
      await load();
    } catch (failure) {
      toast.push("error", describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="طلبات الجملة"
        description="الطلبات القادمة من نموذج الجملة على الموقع. حدّث الحالة بعد التواصل مع العميل."
        actions={
          <Button
            variant="secondary"
            icon={<Icons.refresh size={16} />}
            onClick={() => void load()}
            loading={busy && data !== null}
            data-testid="reload-requests"
          >
            تحديث القائمة
          </Button>
        }
      />

      <div className="stat-row">
        <StatPill
          label="إجمالي الطلبات"
          value={counts.total}
          tone="blue"
          icon={<Icons.inbox size={18} />}
        />
        <StatPill
          label="جديدة في هذه الصفحة"
          value={counts.fresh}
          tone="amber"
          icon={<Icons.bell size={18} />}
        />
        <StatPill
          label="مؤكدة في هذه الصفحة"
          value={counts.confirmed}
          tone="green"
          icon={<Icons.checkCircle size={18} />}
        />
      </div>

      <Card
        title="قائمة الطلبات"
        icon={<Icons.clipboard size={18} />}
        description={
          data ? `${data.total} طلب — صفحة ${data.page} من ${data.pages}` : undefined
        }
      >
        <Toolbar>
          <SearchInput
            value={search}
            onChange={(value) => {
              setPage(1);
              setSearch(value);
            }}
            label="ابحث بالاسم أو رقم التواصل"
            placeholder="ابحث بالاسم أو رقم التواصل…"
          />
          <SegmentedControl
            label="تصفية الحالة"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: "", label: "الكل" },
              ...REQUEST_STATUSES.map((value) => ({
                value,
                label: REQUEST_STATUS_LABELS[value],
              })),
            ]}
          />
        </Toolbar>

        {error ? (
          <ErrorState description={error} onRetry={() => void load()} />
        ) : busy && !data ? (
          <SkeletonRows rows={4} height={56} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Icons.inbox size={30} />}
            title={
              search || status
                ? "لا توجد طلبات مطابقة"
                : "لا توجد طلبات حتى الآن"
            }
            description={
              search || status
                ? "جرّب مسح البحث أو اختيار «الكل»."
                : "ستظهر هنا طلبات الجملة فور إرسالها من الموقع."
            }
          />
        ) : (
          <>
            <TableWrap label="جدول طلبات الجملة">
              <table className="data-table data-table--wide">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>العميل</th>
                    <th>رقم التواصل</th>
                    <th>المنتج</th>
                    <th>الكمية</th>
                    <th>الحالة</th>
                    <th>التاريخ</th>
                    <th>
                      <span className="visually-hidden">إجراءات</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="request-row"
                      data-testid={`request-row-${item.id}`}
                    >
                      <td data-label="#" dir="ltr">
                        {item.id}
                      </td>
                      <td data-label="العميل">
                        <div className="cell-stack">
                          <strong>{item.name}</strong>
                          {item.notes && (
                            <small className="cell-note">{item.notes}</small>
                          )}
                        </div>
                      </td>
                      <td data-label="رقم التواصل" dir="ltr">
                        <a className="cell-link" href={`tel:${item.contact}`}>
                          {item.contact}
                        </a>
                      </td>
                      <td data-label="المنتج">{item.product}</td>
                      <td data-label="الكمية" dir="ltr">
                        {item.quantity} {item.unit}
                      </td>
                      <td data-label="الحالة">
                        {/* The select is the status: its colour follows the
                            value, so the row is scannable without a duplicate
                            badge next to it. */}
                        <div
                          className="select-wrap status-select"
                          data-tone={STATUS_TONE[item.status]}
                        >
                          <select
                            className="input select"
                            aria-label={`حالة الطلب ${item.id}`}
                            value={item.status}
                            onChange={(event) =>
                              void change(
                                item.id,
                                event.target.value as RequestStatus,
                              )
                            }
                          >
                            {REQUEST_STATUSES.map((value) => (
                              <option key={value} value={value}>
                                {REQUEST_STATUS_LABELS[value]}
                              </option>
                            ))}
                          </select>
                          <Icons.chevronDown size={15} className="select-caret" />
                        </div>
                      </td>
                      <td data-label="التاريخ" dir="ltr">
                        {shortDateTime(item.createdAt)}
                      </td>
                      <td data-label="إجراءات">
                        <div className="row-actions">
                          <IconButton
                            label={`حذف الطلب ${item.id}`}
                            variant="danger"
                            icon={<Icons.trash size={16} />}
                            onClick={() => setPendingDelete(item)}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>

            {data && (
              <Pagination
                page={data.page}
                pageCount={data.pages}
                onChange={setPage}
                summary={`${data.total} طلب إجمالًا`}
              />
            )}
          </>
        )}
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="حذف الطلب"
        message={`سيُحذف طلب «${pendingDelete?.name ?? ""}» نهائيًا من اللوحة.`}
        detail={
          pendingDelete
            ? `${pendingDelete.product} — ${pendingDelete.quantity} ${pendingDelete.unit}`
            : undefined
        }
        confirmLabel="حذف الطلب"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
