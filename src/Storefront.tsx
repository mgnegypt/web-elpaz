// Chooses between the one-page site and the two commerce pages.
//
// The site itself stays a single screen with its own section navigation;
// checkout and the order receipt are real URLs because a customer must be
// able to refresh them, share them and use the back button.
import { lazy, Suspense } from "react";
import App from "./App";
import { useRoute } from "./lib/route";

const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
const OrderPage = lazy(() => import("./pages/OrderPage"));

const Fallback = () => (
  <div className="page-loading" role="status">
    جاري التحميل…
  </div>
);

export default function Storefront() {
  const { path } = useRoute();
  if (path === "/checkout")
    return (
      <Suspense fallback={<Fallback />}>
        <CheckoutPage />
      </Suspense>
    );
  if (path === "/order" || path.startsWith("/order/"))
    return (
      <Suspense fallback={<Fallback />}>
        <OrderPage />
      </Suspense>
    );
  return <App />;
}
