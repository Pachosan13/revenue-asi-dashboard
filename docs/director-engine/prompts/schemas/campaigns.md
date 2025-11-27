# Revenue ASI — Schema: Campaigns

Representa una campaña de outbound activa o histórica.

## Campos mínimos (v1)

- `id` — uuid
- `name` — string
- `niche` — string
- `offer` — string
- `target` — string (ICP del cliente)
- `channels` — array (["voice","email","whatsapp"])
- `objective` — string (ej: "10 citas/mes")

- `created_at`
- `updated_at`

## Meta
- Dirigida por el CMO (mensaje)
- Operativizada por el CRO (cadencia)
