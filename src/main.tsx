import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import Storefront from "./Storefront";
import { ContentProvider } from "./content/ContentContext";
import { CartProvider } from "./cart/CartContext";
import "@fontsource/cairo/arabic-400.css";
import "@fontsource/cairo/arabic-500.css";
import "@fontsource/cairo/arabic-600.css";
import "@fontsource/cairo/arabic-700.css";
import "@fontsource/cairo/arabic-800.css";
import "@fontsource/cairo/latin-400.css";
import "@fontsource/cairo/latin-600.css";
import "@fontsource/lalezar/arabic-400.css";
import "./index.css";
import "./admin/admin.css";

const AdminApp = lazy(() => import("./admin/AdminApp"));

const path = window.location.pathname.replace(/\/+$/, "");
const isAdmin = path === "/admin" || path.startsWith("/admin/");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isAdmin ? (
      <Suspense
        fallback={
          <div className="admin-loading" role="status">
            جاري التحميل…
          </div>
        }
      >
        <AdminApp />
      </Suspense>
    ) : (
      // The public site refreshes itself when a visitor returns to the tab.
      <ContentProvider>
        <CartProvider>
          <Storefront />
        </CartProvider>
      </ContentProvider>
    )}
  </React.StrictMode>,
);
