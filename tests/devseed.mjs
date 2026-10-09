// Dev helper (not part of the test suites): creates the owner account on the
// local .data database so the dashboard can be opened while iterating on the UI.
// Usage: node tests/devseed.mjs
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const api = process.env.TEST_API || "http://127.0.0.1:3001";
const dataDir = process.env.DATA_DIR || ".data";

const OWNER = {
  username: "owner",
  email: "owner@elpaze.online",
  displayName: "محمد نجيب",
  bootstrapPassword: "a-very-long-password",
  password: "owner-long-password-1",
  question: "اسم أول حيوان أليف؟",
  answer: "مشمش",
};

const jar = new Map();
const call = async (path, body, csrf, method = "POST") => {
  const headers = { "content-type": "application/json" };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  if (csrf) headers["x-csrf-token"] = csrf;
  const response = await fetch(`${api}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

const tokenFile = join(dataDir, "setup-token");
if (existsSync(tokenFile)) {
  const token = readFileSync(tokenFile, "utf8").trim();
  const setup = await call("/api/admin/setup", {
    token,
    username: OWNER.username,
    password: OWNER.bootstrapPassword,
  });
  console.log("setup", setup.status);
  if (setup.status === 201) {
    const complete = await call(
      "/api/admin/profile/complete",
      {
        displayName: OWNER.displayName,
        email: OWNER.email,
        password: OWNER.password,
        securityQuestion: OWNER.question,
        securityAnswer: OWNER.answer,
      },
      setup.body.csrf,
    );
    console.log("complete", complete.status);
  }
} else {
  console.log("owner already created (no setup token)");
}

// Seed one wholesale request so the operational screens are not empty locally.
const request = await fetch(`${api}/api/wholesale-requests`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "عميل تجريبي",
    contact: "01098765432",
    product: "عسل أبيض طبيعي",
    unit: "كجم",
    quantity: 25,
    notes: "طلب للمعاينة المحلية",
    consent: true,
    requestKey: `dev-seed-${Date.now().toString(36)}`,
  }),
});
console.log("request", request.status);
console.log(`sign in with ${OWNER.email} / ${OWNER.password} / ${OWNER.answer}`);
