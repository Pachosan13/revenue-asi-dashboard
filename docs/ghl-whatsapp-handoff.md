# GHL WhatsApp Handoff (Darmesh)

This doc defines how `mark-prequalified` identifies Darmesh and emits assignment metadata.

## Endpoint

- Internal endpoint: `POST /functions/v1/mark-prequalified`
- Auth: `Authorization: Bearer <MARK_PREQUALIFIED_TOKEN>` (or `x-internal-token`)

## Request payload

```json
{
  "lead_id": "uuid",
  "prequal_ok": true,
  "source": "enc24_ai_prequal",
  "notes": "optional text"
}
```

## Darmesh identity (source of truth)

Set these env vars in Supabase Edge secrets:

- `GHL_DARMESH_USER_ID`: GHL user id for owner assignment.
- `GHL_DARMESH_EMAIL`: fallback identifier when user id is unavailable.

If `GHL_DARMESH_USER_ID` is missing, assignment still carries `GHL_DARMESH_EMAIL`.

## Assignment strategy

Assignment metadata is explicit and configurable:

- `GHL_HANDOFF_ASSIGNMENT_METHOD` (default: `tag`)
- `GHL_HANDOFF_ASSIGNMENT_TARGET` (default: `owner_darmesh`)

Examples:

- Tag-based assignment: `method=tag`, `target=owner_darmesh`
- Custom field assignment: `method=custom_field`, `target=owner_user_id`
- Pipeline assignment: `method=pipeline`, `target=<pipeline_or_stage_id>`

`mark-prequalified` stores this in `public.ghl_handoff_events` and includes it in webhook payload.

## Optional outbound webhook

If configured, handoff is POSTed to GHL/automation webhook:

- `GHL_HANDOFF_WEBHOOK_URL`
- `GHL_HANDOFF_WEBHOOK_TOKEN` (Bearer)

If webhook URL is missing, handoff is still persisted as DB record (`status='recorded'`).
