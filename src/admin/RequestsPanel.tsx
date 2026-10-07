import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  type RequestStatus,
} from "../../shared/content.ts";
import { adminApi, type RequestsPage } from "./api";


export default function RequestsPanel() {
  const [data, setData] = useState<RequestsPage | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await adminApi.requests({ search, status, page }));
    } catch {
      setError("تعذّر تحميل الطلبات.");
    } finally {
      setBusy(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

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
    } catch {
      setError("تعذّر تحديث حالة الطلب.");
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("سيتم حذف الطلب نهائيًا. هل أنت متأكد؟")) return;
    try {
      await adminApi.deleteRequest(id);
      await load();
    } catch {
      setError("تعذّر حذف الطلب.");
    }
  };

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h1>طلبات الجملة</h1>
        <div className="admin-tools">
          <span className="admin-search">
            <Search size={16} />
            <input
              aria-label="ابحث بالاسم أو رقم التواصل"
              placeholder="ابحث بالاسم أو رقم التواصل…"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </span>
          <button className="admin-ghost" data-testid="reload-requests" onClick={() => void load()}>
            <RefreshCw size={15} />
            تحديث
          </button>
        </div>
      </div>

      <div className="admin-filters" role="group" aria-label="تصفية الحالة">
        <button
          className={status === "" ? "active" : ""}
          onClick={() => {
            setStatus("");
            setPage(1);
          }}
        >
          الكل
        </button>
        {REQUEST_STATUSES.map((value) => (
          <button
            key={value}
            className={status === value ? "active" : ""}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
          >
            {REQUEST_STATUS_LABELS[value]}
          </button>
        ))}
      </div>

      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}

      {busy && !data ? (
        <p className="admin-loading-inline">
          <Loader2 className="spin" size={18} /> جاري التحميل…
        </p>
      ) : !data || data.items.length === 0 ? (
        <p className="admin-empty">لا توجد طلبات مطابقة حتى الآن.</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الاسم</th>
                  <th>رقم التواصل</th>
                  <th>المنتج</th>
                  <th>الكمية</th>
                  <th>ملاحظات</th>
                  <th>الحالة</th>
                  <th>التاريخ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} data-testid={`request-row-${item.id}`}>
                    <td dir="ltr">{item.id}</td>
                    <td>{item.name}</td>
                    <td dir="ltr">
                      <a href={`tel:${item.contact}`}>{item.contact}</a>
                    </td>
                    <td>{item.product}</td>
                    <td dir="ltr">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="admin-notes">{item.notes || "—"}</td>
                    <td>
                      <select
                        aria-label={`حالة الطلب ${item.id}`}
                        value={item.status}
                        onChange={(event) =>
                          void change(item.id, event.target.value as RequestStatus)
                        }
                      >
                        {REQUEST_STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {REQUEST_STATUS_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td dir="ltr" className="admin-date">
                      {new Date(item.createdAt).toLocaleDateString("ar-EG")}
                    </td>
                    <td>
                      <button
                        className="admin-icon danger"
                        aria-label={`حذف الطلب ${item.id}`}
                        onClick={() => void remove(item.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-pagination">
            <button
              className="admin-ghost"
              disabled={data.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              السابق
            </button>
            <span dir="ltr">
              {data.page} / {data.pages} · {data.total} طلب
            </span>
            <button
              className="admin-ghost"
              disabled={data.page >= data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              التالي
            </button>
          </div>
        </>
      )}
    </section>
  );
}
