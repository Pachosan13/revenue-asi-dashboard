# Revenue ASI — Schema: Touches (Contact Attempts)

Cada interaction/attempt que hace el sistema a un lead.

## Campos (v1)

- `id` — uuid
- `lead_id` — uuid
- `campaign_id` — uuid
- `step` — integer (posición en la cadencia)
- `channel` — string
  - `voice`, `email`, `whatsapp`, `sms`
- `status` — string
  - `sent`
  - `failed`
  - `error`
  - `responded`
  - `schedule_request`

- `payload` — json (lo enviado)
- `sent_at` — timestamp
- `created_at` — timestamp

## Meta
- El CRO usa los “touches” para:
  - medir respuestas,
  - calcular error rate,
  - decidir si reciclar o detener lead.
