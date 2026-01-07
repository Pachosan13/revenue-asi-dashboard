# Billing (FORGE / Revenue ASI)

This repo implements **billing statements** (auditable usage), **not payments**.

## What gets billed

Only **provider-accepted** deliveries are billable:
- **sms**: Telnyx accepted message (use Telnyx message id)
- **voice**: Telnyx accepted call initiation (use Telnyx call control id or provider acceptance id)
- **email**: Elastic accepted send (use provider acceptance id)
- **whatsapp**: TBD provider

Not billable:
- failed sends
- retries / attempts
- dry runs / simulations

## Units model (define once, enforce forever)

- **Voice**: `units = billed_seconds` (integer seconds). No rounding is performed by the ledger layer; callers must decide how to round.

## Source of truth: `public.usage_ledger`

`public.usage_ledger` is an **immutable** append-only ledger used for audit and statements.

### Idempotency strategy

Each provider-accepted event is recorded once with:

- `UNIQUE(account_id, channel, provider, ref_id)`

The code inserts once; if a duplicate occurs it returns the existing row.

## Recording usage (single internal entrypoint)

Use:
- `src/lib/billing/ledger.ts` → `recordUsageEvent(...)`

Call this **only after** a provider acceptance is confirmed (webhook/event indicates accepted).

Recommended wiring points:
- Provider webhook handlers (Telnyx/Twilio/Elastic): after acceptance, call `recordUsageEvent`.
- Dispatchers should NOT record usage unless they have a definitive provider acceptance id.

## Credits / refunds (future)

Billing v1 ships without adjustments. If/when we add credits/refunds, we will do it via additional immutable ledger events (never mutating history).

## Regression note: Authorization header in App Router

In Next.js App Router route handlers, `req.headers.get("authorization")` can be unreliable in some setups.
We use `next/headers` `headers()` via `getAccessTokenFromRequest()` for consistent Bearer token parsing.

### Curl (local Next.js → Supabase Cloud)

```bash
curl -i -sS 'http://127.0.0.1:3000/api/account/active' \
  -H "Authorization: Bearer $TEST_JWT"

curl -sS 'http://127.0.0.1:3000/api/billing/summary' \
  -H "Authorization: Bearer $TEST_JWT" | jq
```

## Statements (for future payments layer)

Statements are monthly aggregates:
- `src/lib/billing/statements.ts` → `finalizeBillingStatement(account_id, period_start, period_end)`

This writes a row into `public.billing_statements` (idempotent per `(account_id, period_start, period_end)`).

### Payments layer (future)

A payments layer (Stripe/local bank transfer/etc.) should:
- read finalized rows from `public.billing_statements`
- create invoices/charges externally
- store payment status separately (do NOT mutate the ledger)


