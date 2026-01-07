// Minimal Billing v1 smoke test (Next.js local -> Supabase Cloud)
// Usage:
//   TEST_JWT=... TEST_ACCOUNT_ID=... node scripts/billing_smoke_test.mjs
//
// Optional:
//   BASE_URL=http://127.0.0.1:3000
//   BILLING_INTERNAL_ONLY=true BILLING_INTERNAL_TOKEN=...

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";
const jwt = process.env.TEST_JWT || "";
const accountId = process.env.TEST_ACCOUNT_ID || "";
const internalToken = process.env.BILLING_INTERNAL_TOKEN || "";

if (!accountId) {
  console.error("Missing TEST_ACCOUNT_ID");
  process.exit(2);
}

const headers = {
  "Content-Type": "application/json",
  Cookie: `revenue_account_id=${encodeURIComponent(accountId)}`,
};

if (process.env.BILLING_INTERNAL_ONLY === "true") {
  headers["x-internal-token"] = internalToken;
} else {
  if (!jwt) {
    console.error("Missing TEST_JWT (or set BILLING_INTERNAL_ONLY=true)");
    process.exit(2);
  }
  headers["Authorization"] = `Bearer ${jwt}`;
}

const res = await fetch(`${baseUrl}/api/billing/summary`, { headers });
const json = await res.json().catch(() => ({}));

console.log(JSON.stringify({ status: res.status, ...json }, null, 2));

if (!json?.ok) process.exit(1);
process.exit(0);


