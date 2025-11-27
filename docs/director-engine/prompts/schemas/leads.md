# Revenue ASI — Schema: Leads

Representa un lead único dentro del sistema.

## Campos mínimos (v1)

- `id` — uuid
- `full_name` — string
- `email` — string (opcional)
- `phone` — string (opcional)
- `company` — string
- `role` — string (ej: owner, manager, dentist)
- `niche` — string (ej: "dentistas", "dealers", "loaners")
- `source` — string (ej: "import", "manual", "inbound")
- `status` — string  
  - `new`  
  - `enriched`  
  - `contacted`  
  - `responded`  
  - `interested`  
  - `dead`

- `created_at` — timestamp

## Notas del sistema (ASI)
- Para priorización, el CRO puede etiquetar:
  - `hot` → match alto + respuesta reciente
  - `warm`
  - `cold`
- El CMO usa `niche`, `role` y `pain points` para mensajes.
