// Order pipeline: pricing, stock, idempotency, privacy and the admin workflow.
// Everything runs against a throwaway database with the real Express app.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loginWithSecurity, setupOwner, startTestServer } from "./helper.mjs";

let api;

before(async () => {
  api = await startTestServer();
});

after(async () => {
  await api?.close();
});

/** Rewrites the stored catalogue/commerce block the way the dashboard would. */
const patchContent = (change) => {
  const current = api.db.getContent();
  const { revision, ...content } = current;
  return api.db.saveContent(change(structuredClone(content)), revision);
};

/** Two priced products plus a deliberately unpriced one. */
const seedCatalogue = () =>
  patchContent((content) => {
    content.commerce = {
      ...content.commerce,
      ordersEnabled: true,
      currency: "ج.م",
      codEnabled: false,
      deliveryZones: [],
      freeDeliveryOver: null,
      minOrderTotal: 0,
      checkoutNote: "",
      whatsappSummary: true,
    };
    content.products = content.products.map((product, index) => {
      if (index === 0)
        return {
          ...product,
          price: 100,
          discountPercent: 0,
          availability: "available",
          quantity: 10,
        };
      if (index === 1)
        return {
          ...product,
          price: 50,
          discountPercent: 20,
          availability: "available",
          quantity: 4,
        };
      if (index === 2)
        return { ...product, price: null, availability: "available", quantity: null };
      return { ...product, price: null };
    });
    return content;
  });

const ids = () => {
  const products = api.db.getContent().products;
  return { priced: products[0].id, discounted: products[1].id, unpriced: products[2].id };
};

let keyCounter = 0;
const draft = (overrides = {}) => ({
  customer: {
    name: "سارة محمد",
    phone: "01012345678",
    address: "٥ شارع الهرم، الدور الثالث، شقة ٧",
    area: "الهرم",
    notes: "",
    ...(overrides.customer ?? {}),
  },
  items: overrides.items ?? [{ productId: ids().priced, quantity: 2 }],
  deliveryZoneId: overrides.deliveryZoneId ?? "",
  paymentMethod: overrides.paymentMethod ?? "on_confirmation",
  requestKey: overrides.requestKey ?? `order-key-${(keyCounter += 1)}`,
  ...(overrides.extra ?? {}),
});

beforeEach(() => {
  // Each test starts from the same catalogue; orders accumulate on purpose so
  // the stats test sees a realistic mix.
  seedCatalogue();
});

test("an order is priced from the catalogue, never from the client", async () => {
  const { priced, discounted } = ids();
  const response = await api.json(
    "/api/orders",
    "POST",
    draft({
      items: [
        { productId: priced, quantity: 2 },
        { productId: discounted, quantity: 1 },
      ],
      // A tampered client trying to set its own amounts:
      extra: { subtotal: 1, total: 1, shipping: 0, currency: "USD" },
    }),
  );

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.match(response.body.reference, /^EB-\d{6}-[A-Z0-9]{5}$/);
  assert.equal(typeof response.body.accessToken, "string");

  const order = response.body.order;
  // 2 × 100 + 1 × (50 − 20%) = 240
  assert.equal(order.subtotal, 240);
  assert.equal(order.discountTotal, 10);
  assert.equal(order.total, 240);
  assert.equal(order.shipping, null, "no zones configured → fee stays unknown");
  assert.equal(order.currency, "ج.م");
  assert.equal(order.status, "pending");
  assert.equal(order.itemCount, 3);
});

test("stock is reserved atomically and an oversized order is refused", async () => {
  const { discounted } = ids();
  const before = api.db
    .getContent()
    .products.find((product) => product.id === discounted).quantity;

  const ok = await api.json(
    "/api/orders",
    "POST",
    draft({ items: [{ productId: discounted, quantity: 3 }] }),
  );
  assert.equal(ok.status, 201);
  const after = api.db
    .getContent()
    .products.find((product) => product.id === discounted).quantity;
  assert.equal(after, before - 3, "stock must drop by exactly what was ordered");

  const tooMany = await api.json(
    "/api/orders",
    "POST",
    draft({ items: [{ productId: discounted, quantity: 5 }] }),
  );
  assert.equal(tooMany.status, 409);
  assert.equal(tooMany.body.error, "items-changed");
  assert.equal(tooMany.body.problems[0].reason, "insufficient-stock");
  assert.equal(tooMany.body.problems[0].available, after);
});

test("a product without a published price can never be bought online", async () => {
  const { unpriced } = ids();
  const response = await api.json(
    "/api/orders",
    "POST",
    draft({ items: [{ productId: unpriced, quantity: 1 }] }),
  );
  assert.equal(response.status, 409);
  assert.equal(response.body.problems[0].reason, "unpriced");
});

test("the same request key never creates a second order, a changed payload is a conflict", async () => {
  const requestKey = "double-tap-key";
  const first = await api.json("/api/orders", "POST", draft({ requestKey }));
  assert.equal(first.status, 201);

  const repeat = await api.json("/api/orders", "POST", draft({ requestKey }));
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.duplicate, true);
  assert.equal(repeat.body.reference, first.body.reference);
  assert.equal(repeat.body.accessToken, null, "the token is issued once only");

  const tampered = await api.json(
    "/api/orders",
    "POST",
    draft({ requestKey, items: [{ productId: ids().priced, quantity: 9 }] }),
  );
  assert.equal(tampered.status, 409);
  assert.equal(tampered.body.error, "request-key-conflict");

  const rows = api.db.listOrders({ limit: 50, offset: 0 });
  assert.equal(
    rows.items.filter((order) => order.reference === first.body.reference).length,
    1,
  );
});

test("invalid customer payloads are rejected before anything is stored", async () => {
  const before = api.db.listOrders({ limit: 1, offset: 0 }).total;
  const cases = [
    ["short name", draft({ customer: { name: "س" } })],
    ["bad phone", draft({ customer: { phone: "12345" } })],
    ["short address", draft({ customer: { address: "ش" } })],
    ["empty basket", draft({ items: [] })],
    ["zero quantity", draft({ items: [{ productId: ids().priced, quantity: 0 }] })],
    ["honeypot filled", draft({ extra: { honeypot: "http://spam" } })],
  ];
  for (const [label, payload] of cases) {
    const response = await api.json("/api/orders", "POST", payload);
    assert.equal(response.status, 422, `${label} must be refused`);
  }
  assert.equal(api.db.listOrders({ limit: 1, offset: 0 }).total, before);
});

test("Egyptian phone numbers are accepted in the formats people actually type", async () => {
  for (const phone of ["+20 101 234 5678", "0020-10-1234-5678", "0101 234 5678"]) {
    const response = await api.json(
      "/api/orders",
      "POST",
      draft({ customer: { phone } }),
    );
    assert.equal(response.status, 201, `${phone} must be accepted`);
    assert.equal(response.body.order.customer.phone, "01012345678");
  }
});

test("delivery zones and the free-delivery threshold come from configuration only", async () => {
  patchContent((content) => {
    content.commerce.deliveryZones = [{ id: "giza", name: "الجيزة", fee: 25, note: "" }];
    content.commerce.freeDeliveryOver = 300;
    return content;
  });

  const missingZone = await api.json("/api/orders", "POST", draft());
  assert.equal(missingZone.status, 422);
  assert.equal(missingZone.body.error, "zone-required");

  const withFee = await api.json(
    "/api/orders",
    "POST",
    draft({ deliveryZoneId: "giza", items: [{ productId: ids().priced, quantity: 2 }] }),
  );
  assert.equal(withFee.status, 201);
  assert.equal(withFee.body.order.shipping, 25);
  assert.equal(withFee.body.order.total, 225);
  assert.equal(withFee.body.order.deliveryZoneName, "الجيزة");

  const freeDelivery = await api.json(
    "/api/orders",
    "POST",
    draft({ deliveryZoneId: "giza", items: [{ productId: ids().priced, quantity: 3 }] }),
  );
  assert.equal(freeDelivery.body.order.shipping, 0);
  assert.equal(freeDelivery.body.order.total, 300);
});

test("the minimum order value and the master switch are enforced server-side", async () => {
  patchContent((content) => {
    content.commerce.minOrderTotal = 500;
    return content;
  });
  const small = await api.json("/api/orders", "POST", draft());
  assert.equal(small.status, 422);
  assert.equal(small.body.error, "below-minimum");

  patchContent((content) => {
    content.commerce.minOrderTotal = 0;
    content.commerce.ordersEnabled = false;
    return content;
  });
  const off = await api.json("/api/orders", "POST", draft());
  assert.equal(off.status, 503);
  assert.equal(off.body.error, "orders-disabled");
});

test("cash on delivery is only accepted when the business enabled it", async () => {
  const refused = await api.json(
    "/api/orders",
    "POST",
    draft({ paymentMethod: "cod" }),
  );
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error, "payment-unavailable");

  patchContent((content) => {
    content.commerce.codEnabled = true;
    return content;
  });
  const accepted = await api.json(
    "/api/orders",
    "POST",
    draft({ paymentMethod: "cod" }),
  );
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.order.paymentMethod, "cod");
});

test("an order can only be read back with its own token, and leaks nothing internal", async () => {
  const created = await api.json("/api/orders", "POST", draft());
  const { reference, accessToken } = created.body;

  const ok = await api.request(
    `/api/orders/${reference}?token=${encodeURIComponent(accessToken)}`,
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.body.order.reference, reference);
  assert.equal(ok.body.order.id, undefined, "internal row id must stay private");
  assert.ok(
    ok.body.order.history.every((entry) => entry.note === undefined),
    "staff notes must never reach the customer",
  );
  assert.match(ok.headers.get("x-robots-tag") ?? "", /noindex/);

  const noToken = await api.request(`/api/orders/${reference}`);
  assert.equal(noToken.status, 404);

  const wrongToken = await api.request(`/api/orders/${reference}?token=not-the-token`);
  assert.equal(wrongToken.status, 404);

  const guessed = await api.request(
    `/api/orders/EB-000000-AAAAA?token=${encodeURIComponent(accessToken)}`,
  );
  assert.equal(guessed.status, 404);
});

test("the cart pricing endpoint mirrors what an order would cost", async () => {
  const { priced, discounted } = ids();
  const response = await api.json("/api/cart/price", "POST", {
    items: [
      { productId: priced, quantity: 1 },
      { productId: discounted, quantity: 2 },
    ],
    deliveryZoneId: "",
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ordersEnabled, true);
  assert.equal(response.body.priced.subtotal, 180);
  assert.equal(response.body.priced.discountTotal, 20);
});

test("the admin order endpoints reject anonymous callers", async () => {
  const anonymous = api.createClient();
  for (const [path, init] of [
    ["/api/admin/orders", {}],
    ["/api/admin/orders/1", {}],
  ]) {
    const response = await anonymous.request(path, init);
    assert.equal(response.status, 401, `${path} must require a session`);
  }
  const patch = await anonymous.json("/api/admin/orders/1", "PATCH", {
    status: "confirmed",
  });
  assert.ok([401, 403].includes(patch.status));
});

test("an administrator moves an order through the workflow, and cancelling restocks", async () => {
  const admin = api.createClient();
  const { session } = await setupOwner(api, admin);
  const csrf = { "x-csrf-token": session.body.csrf };

  const created = await api.json(
    "/api/orders",
    "POST",
    draft({ items: [{ productId: ids().priced, quantity: 2 }] }),
  );
  const id = api.db.getOrderByReference(
    created.body.reference,
    created.body.accessToken,
  ).id;

  const list = await admin.request("/api/admin/orders");
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some((order) => order.id === id));
  assert.ok(list.body.stats.total >= 1);

  const confirmed = await admin.json(
    `/api/admin/orders/${id}`,
    "PATCH",
    { status: "confirmed", note: "اتصلنا بالعميل" },
    csrf,
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.order.status, "confirmed");

  // Skipping a step is refused by the shared transition table.
  const illegal = await admin.json(
    `/api/admin/orders/${id}`,
    "PATCH",
    { status: "delivered" },
    csrf,
  );
  assert.equal(illegal.status, 409);
  assert.equal(illegal.body.error, "invalid-transition");

  const stockBefore = api.db
    .getContent()
    .products.find((product) => product.id === ids().priced).quantity;
  const cancelled = await admin.json(
    `/api/admin/orders/${id}`,
    "PATCH",
    { status: "cancelled", note: "العميل اعتذر" },
    csrf,
  );
  assert.equal(cancelled.body.order.status, "cancelled");
  const stockAfter = api.db
    .getContent()
    .products.find((product) => product.id === ids().priced).quantity;
  assert.equal(stockAfter, stockBefore + 2, "cancelling must return the stock");

  // A cancelled order is final.
  const revive = await admin.json(
    `/api/admin/orders/${id}`,
    "PATCH",
    { status: "confirmed" },
    csrf,
  );
  assert.equal(revive.status, 409);

  // The customer sees the status, but never the internal note.
  const customer = await api.request(
    `/api/orders/${created.body.reference}?token=${encodeURIComponent(created.body.accessToken)}`,
  );
  assert.equal(customer.body.order.status, "cancelled");
  assert.ok(!JSON.stringify(customer.body).includes("العميل اعتذر"));
});

test("revenue excludes cancelled orders and best sellers come from real lines", async () => {
  const admin = api.createClient();
  await loginWithSecurity(
    admin,
    "owner@elpaze.online",
    "owner-final-password-1",
    "مشمش",
  );
  const stats = (await admin.request("/api/admin/orders")).body.stats;

  const all = api.db.listOrders({ limit: 500, offset: 0 }).items;
  const expected = all
    .filter((order) => order.status !== "cancelled")
    .reduce((sum, order) => sum + order.total, 0);
  assert.equal(stats.revenue, Math.round(expected * 100) / 100);
  assert.equal(stats.total, all.length);
  assert.ok(stats.bestSellers.length > 0);
  assert.ok(
    stats.bestSellers.every((entry) => entry.quantity > 0),
    "a best seller must have a real quantity behind it",
  );
});

test("a stored document without a commerce block still loads (backward compatible)", () => {
  const { revision, ...content } = api.db.getContent();
  delete content.commerce;
  for (const product of content.products) delete product.price;
  api.db.raw
    .prepare("UPDATE content SET json = ?, revision = ? WHERE id = 1")
    .run(JSON.stringify(content), revision + 1);

  const reloaded = api.db.getContent();
  assert.equal(reloaded.commerce.ordersEnabled, true);
  assert.equal(reloaded.commerce.deliveryZones.length, 0);
  assert.equal(reloaded.commerce.codEnabled, false);
  assert.equal(reloaded.products[0].price, null, "a missing price must read as null");
});
