# Revenue ASI — Schema: Appointments

Cuando un lead agenda o muestra intención clara de agendar.

## Campos (v1)

- `id` — uuid
- `lead_id` — uuid
- `campaign_id` — uuid
- `source` — string (voice/email/whatsapp)
- `status` — string
  - `booked`
  - `pending_confirmation`
  - `no_show`
  - `completed`

- `scheduled_for` — timestamp
- `created_at` — timestamp

## Meta
- KPI clave del negocio.
- El CFO usa estos datos para unit economics.
