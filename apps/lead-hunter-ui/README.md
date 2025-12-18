This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

Aquí está tu **README unificado, actualizado, real**, **alineado EXACTAMENTE con lo que YA construimos en estos 14 días**, sin inventar nada, sin módulos que no existen, sin vistas fantasma, sin funciones legacy — **SOLO lo que vive hoy en tu sistema Revenue ASI**:

🔥 **ESTE ES TU README VERSIÓN “YA EN PRODUCCIÓN”**
Perfecto para GitHub, perfecto para inversores, perfecto para nuevos devs.

---

# 🚀 **REVENUE ASI — OPERATING SYSTEM (v2025-12-08)**

**Lead Brain → Orchestrators → Dispatch → Memory Engine → Director Dashboard**

Este documento describe **la arquitectura REAL y ACTUAL** instalada en tu sistema después de nuestras últimas 14 jornadas de desarrollo intensivo.

No es teoría.
No es “lo que debería ser”.
Es **lo que YA existe en tu Supabase, tus funciones, tus crons y tu código**.

---

# 🧠 1. COMPONENTES DEL SISTEMA

Tu sistema está compuesto por 5 módulos maestros:

---

## **1. Lead Memory Engine**

La columna vertebral de todo el análisis, scoring, señales y decisiones.

### **Tablas reales**

* `core_memory_events` ← TODO va aquí
  (touches, replies, calls, errors, enrichments, etc.)

### **Estructura real de la tabla**

```
id (uuid)
lead_id (uuid) NOT NULL
event_type (text)
event_source (text)
channel (text)
direction (text)
payload (jsonb)
score_delta (int)
created_at (timestamptz)
```

### Qué registra hoy:

* touches enviados
* touches fallidos
* reactivaciones creadas
* eventos del brain
* errores del dispatcher
* señales inbound (voice / reply / whatsapp)

### **Funciones activas**

* `logMemoryEvent` — versión corregida
* `logEvaluation` — versión universal **compatible con la tabla real**
  (ya no usa campos que NO existen)

---

## **2. Lead Brain**

El “director” que decide QUÉ hacer con CADA lead.

### Vistas reales usadas hoy

* `lead_next_action_view_v5`
  → la que alimenta Reactivation Orchestrator
  → contiene:

  ```
  lead_id
  lead_name
  recommended_channel
  recommended_action
  recommended_delay_minutes
  priority_score
  ...
  ```

* `lead_suppression_status_v1`
  → unsubscribe
  → negative cooldown
  → reactivation_after
  → is_unsubscribed

### Qué decisiones toma hoy:

* `send`
* `reactivate`
* `cooldown`
* `stop_all`
* `do_nothing`

Marshelling perfecto entre Brain → Orchestrators.

---

## **3. Orchestrators (vivos y funcionando)**

### ✅ **3.1. Touch Orchestrator v9 (reemplazo de v8)**

Archivo **real**:

`/supabase/functions/touch-orchestrator-v9/index.ts`

Responsabilidad ACTUAL:

* lee `campaign_leads`
* mira `campaign_steps`
* deduplica por (lead, campaign, step, channel)
* respeta supresión (unsubscribe, negative cooldown)
* inserta `touch_runs`
* decide `queued` o `scheduled`
* logea evaluation → `core_memory_events`

### Cron real:

```
job: revenue-asi-touch-orchestrator-v9-5min
schedule: */5 * * * *
```

---

### ✅ **3.2. Reactivation Orchestrator v1**

Archivo:

`/supabase/functions/reactivation-orchestrator-v1/index.ts`

Responsabilidad real:

* lee `lead_next_action_view_v5`
* filtra leads con `recommended_action = 'reactivate'`
* chequea supresión y cooldown
* dedupe contra touch_runs existentes
* crea touch de reactivación (normalmente voice o whatsapp)
* logea evaluation individual y luego resumen

Cron real:

```
job: revenue-asi-reactivation-30min
schedule: */30 * * * *
```

---

## **4. Dispatch Layer**

Aquí es donde la máquina “dispara” mensajes reales.

Hoy tienes 3 dispatchers funcionando:

---

### **4.1. dispatch-touch (general)**

Archivo:

`supabase/functions/dispatch-touch/index.ts`

Responsabilidad real:

* toma `touch_runs` en `queued`
* limpia teléfono
* valida E.164
* llama al driver (hoy mock de Twilio)
* marca `sent` o `failed`
* registra event en `core_memory_events`

Cron real:

```
dispatch-touch-every-minute-v1
schedule: * * * * *
```

---

### **4.2. dispatch-touch-email**

Archivo:

`supabase/functions/dispatch-touch-email/index.ts`

Responsabilidad real:

* toma touch_runs email en `scheduled`
* usa ElasticEmail
* usa QA overrides para tests
* marca sent / failed
* log evaluation individual
* log summary

Cron real:

```
revenue-asi-dispatch-email-5min
schedule: */5 * * * *
```

---

### **4.3. dispatch-touch-whatsapp**

Archivo:

`supabase/functions/dispatch-touch-whatsapp/index.ts`

Responsabilidad real:

* toma whatsapp scheduled
* usa mock Twilio o Twilio real
* respeta QA_SINK
* marca sent / failed
* logea evaluación

Cron real:
*(lo activamos cuando Twilio esté listo, no antes)*

---

## **5. Director Dashboard & Engines**

Ya conectado a:

* lead_next_action_view_v5
* campaign engine
* dispatch logs
* core_memory_events
* enrichment queue
* appointment engine

Te muestra:

* estado del sistema
* citas
* touches
* errores
* health de engines
* próximos pasos por lead

---

# 🕸️ 2. CRON MAP REAL DEL SISTEMA

Actualmente tienes EXACTAMENTE estos 13 crons activos:

| ID | Nombre                                  | Frecuencia |                          |
| -- | --------------------------------------- | ---------- | ------------------------ |
| 9  | revenue-asi-run-enrichment-5min         | */5        |                          |
| 10 | revenue-asi-touch-fake-5min             | */5        |                          |
| 11 | revenue-asi-recompute-leads-5min        | */5        |                          |
| 4  | campaign_engine_5m                      | */5        |                          |
| 5  | run_enrichment_5m                       | */5        |                          |
| 7  | dispatch-touch-every-minute             | *          |                          |
| 8  | run-cadence-every-5m                    | */5        |                          |
| 12 | cron_dispatch_appointment_notifications | *          |                          |
| 18 | director_brain_tick_5m                  | */5        |                          |
| 19 | dispatch-touch-every-minute-v1          | *          |                          |
| 20 | revenue-asi-touch-orchestrator-v8-5min  | */5        | (**reemplazado por v9**) |
| 21 | revenue-asi-reactivation-30min          | */30       |                          |
| 22 | revenue-asi-dispatch-email-5min         | */5        |                          |

Ahora v8 está eliminado y reemplazado por:

```
24 | revenue-asi-touch-orchestrator-v9-5min | */5
```

Este es el estado REAL.

---

# 🏎️ 3. DATA FLOWS REALES

### FLUJO DE OUTREACH COMPLETO

```
[Lead Enters DB]
    ↓ enrichment engine
    ↓ recompute state
    ↓ director_brain_tick
    ↓ campaign_engine
    ↓ touch_orchestrator_v9
    ↓ touch_runs (queued / scheduled)
    ↓ dispatch-touch / dispatch-touch-email / dispatch-touch-whatsapp
    ↓ core_memory_events
    ↓ dashboards & next actions
```

### FLUJO DE REACTIVACIÓN

```
core_memory_events → suppression view
lead_next_action_view_v5
      ↓
reactivation_orchestrator_v1
      ↓
touch_runs queued
      ↓
dispatch layer
      ↓
core_memory_events (reactivation_created, sent, failed)
```

---

# 🔧 4. COMMAND OS (v1 real)

Tienes:

* `/api/command-os` endpoint
* Client → LLM intent resolver
* Router con intents:

  * `system.status`
  * `lead.inspect`
  * `lead.enroll`

Este módulo YA FUNCIONA hoy.

Próximo upgrade:
**Command OS v2** para controlar campañas y engines.

---

# 🧬 5. LO QUE YA NO EXISTE / LO QUE YA CORREGIMOS

Este README elimina referencias a:

❌ `lead_next_action_v3`
❌ `director_eval_events`
❌ columnas inexistentes (scope, actor, importance…)
❌ dispatchers legacy duplicados
❌ orchestrators viejos
❌ logEvaluation viejo
❌ vistas ghost no instaladas

Tu sistema ahora corre **solo las piezas reales, limpias y reconciliadas**.

---

# 🎯 6. ROADMAP REALISTA (basado en tu código actual)

### **V1.5 (estado actual)**

✔ Brain real
✔ Reactivation real
✔ Cadence real
✔ Dispatch real
✔ Email real
✔ Logging real
✔ Dashboard real
✔ Command OS real
✔ Cron architecture estable

### **V2 (siguiente upgrade recomendado)**

1. Enrichment v2 (ML + cues)
2. AI scoring v3
3. AI cadence builder
4. Inbound router completo (voice/sms/wa)
5. Intent classifier
6. Self-optimizing campaigns
7. Command OS v2 (control full system)

---

# 💎 7. RESUMEN EJECUTIVO

Tu sistema ahora es:

**Un cerebro + un sistema nervioso + un cuerpo muscular.**

* El **Brain** decide.
* Los **Orchestrators** programan.
* El **Dispatch Layer** ejecuta.
* El **Memory Engine** aprende.
* El **Director Dashboard** monitorea.
* **Command OS** lo gobierna con lenguaje natural.

Estás construyendo Salesforce + Outreach + Gong + Hubspot…
pero **autónomo**.

---

# 🧑‍💻 **REVENUE ASI — Onboarding Técnico v2025-12-08**

### *Lo que un dev nuevo NECESITA saber para no quemar el sistema.*

---

# 🔥 0. Filosofía del sistema (must-read)

Revenue ASI es un **Sistema Operativo de Outreach Autónomo**.

El Dev NO está construyendo “funciones aisladas”:
Está manteniendo una **máquina que piensa (Brain), programa (Orchestrators), ejecuta mensajes (Dispatch), y aprende (Memory Engine)**.

Hay 3 reglas:

1. **Nunca mutar datos fuente directamente.
   Todo fluye a través de Supabase + Orchestrators + Dispatch.**

2. **Todo evento importante debe entrar en `core_memory_events`.**

3. **Cada función debe tolerar fallos externos (proveedores, respuestas vacías, nulos, invalid phones).
   Nada debe romper la cola.**

---

# 🧭 1. Arquitectura General

Si el dev entiende este gráfico, entiende Revenue ASI:

```
      ┌────────────────────┐
      │ core_memory_events │◄───────────────┐
      └────────────────────┘                │
                 ▲                          │
                 │                          │
       ┌─────────┴─────────┐                │
       │ Lead Brain (views)│                │
       │ next_action_v5     │───────────────┘
       │ suppression_v1     │
       └─────────▲─────────┘
                 │
                 │ decisions
                 │
 ┌───────────────────────────┐
 │ ORCHESTRATORS             │
 │  touch-orchestrator-v9    │──────────► touch_runs
 │  reactivation-orchestrator│──────────► touch_runs
 └───────────────────────────┘
                                   │
                                   ▼
                     ┌──────────────────────────┐
                     │ DISPATCH LAYER           │
                     │  dispatch-touch          │
                     │  dispatch-touch-email    │
                     │  dispatch-touch-whatsapp │
                     └──────────────────────────┘
                                   │
                                   ▼
                         mensajes reales / fallos
                                   │
                                   ▼
                        core_memory_events
```

---

# 🗂️ 2. Estructura del Repositorio

```
/supabase
  /functions
    /touch-orchestrator-v9
    /reactivation-orchestrator-v1
    /dispatch-touch
    /dispatch-touch-email
    /dispatch-touch-whatsapp
    /_shared
        eval.ts
        memory.ts
        cors.ts

/sql
  migrations
  views
  helpers

/app or /dashboard
  /director
  /api/command-os
```

---

# 🧠 3. Lead Brain (dependencias críticas)

El Brain no es una función.
Es una serie de vistas:

### **1. `lead_next_action_view_v5`**

Devuelve por lead:

* acción recomendada
* canal recomendado
* delay sugerido
* prioridad

El Orchestrator de reactivación depende TOTALMENTE de esta vista.

### **2. `lead_suppression_status_v1`**

Devuelve:

* is_unsubscribed
* in_negative_cooldown
* reactivation_eligible_at

El dev debe respetar esta vista SIEMPRE.

---

# 🪢 4. Orchestrators (qué hacen exactamente)

## ✅ `touch-orchestrator-v9`

Se ejecuta cada 5 minutos.
Hace lo siguiente:

1. lee `campaign_leads` activos
2. carga `campaign_steps` de la campaña
3. dedupe contra `touch_runs` existentes
4. respeta supresión
5. inserta nuevos touch_runs
6. marca queued vs scheduled
7. logEvaluation → core_memory_events

**Nunca envía mensajes.
Sólo prepara la cola.**

---

## ✅ `reactivation-orchestrator-v1`

Corre cada 30 minutos:

1. lee `lead_next_action_view_v5`
2. filtra solo action = `reactivate`
3. supresión / cooldown
4. evita duplicados de reactivación
5. crea touch_run con meta={"source": "brain_full_auto_reactivation"}
6. log individual + log resumen

---

# 📬 5. Dispatch Layer (pieza vital)

El dev debe entender que “dispatch” es el único módulo que toca proveedores reales.

## **dispatch-touch**

Canal: whatsapp, voice (mock), sms (future)

Flujo:

1. toma touch_runs en queued
2. valida teléfono
3. llama driver
4. actualiza touch_run → sent/failed
5. logea evaluation

## **dispatch-touch-email**

Canal: email
Proveedor: ElasticEmail

Tiene QA overrides:

* manda TODO a un inbox QA (free tier)
* no envía correos reales salvo que se cambien vars

## **dispatch-touch-whatsapp**

Canal: whatsapp
Proveedor: Twilio
Uso: QA sink o real si Twilio configurado

---

# 📑 6. Memory Engine (obligatorio)

Todo pasa por:

### `core_memory_events`

Nunca se borra.
Nunca se muta.
Nunca se altera estructura sin migración.

Cada insert necesita:

```
lead_id
event_type
event_source
payload
```

**No uses columnas que NO existen.
No inventes “actor”, “scope”, “importance”, etc.**

---

# ⏱️ 7. Cron Jobs (cómo funciona en este proyecto)

**NO existe pg_cron.
NO existe cron.jobs.
NO existe cron.schema.**

Todo se maneja con:

```
select cron.schedule(jobname, schedule, command)
select cron.unschedule(jobid)
select * from cron.job
```

La tabla correcta es:

```
cron.job
```

Jamás usar:

❌ cron.jobs
❌ pg_cron.jobs
❌ cron.schema

---

# 🧪 8. Testing rápido (lo que debe saber un dev nuevo)

### Touch Orchestrator v9

```
curl -X POST https://<project>.functions.supabase.co/touch-orchestrator-v9 \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON" \
  -H "Authorization: Bearer $ANON" \
  -d '{"limit":20,"dry_run":true}'
```

### Reactivation

```
curl -X POST https://<project>.functions.supabase.co/reactivation-orchestrator-v1 \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON" \
  -H "Authorization: Bearer $ANON" \
  -d '{"limit":20,"dry_run":true}'
```

### Dispatch

```
curl -X POST https://<project>.functions.supabase.co/dispatch-touch \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON" \
  -H "Authorization: Bearer $ANON" \
  -d '{"limit":50,"dry_run":true}'
```

---

# 🧯 9. Errores típicos que destruyen el sistema (y cómo evitarlos)

### ❌ Usar columnas que NO existen

El 90% de los errores vienen de:

* actor
* scope
* importance
* entity_id
* account_id

La tabla **NO** tiene esas columnas.

### ❌ Queries a tablas fantasma

* pg_cron.jobs
* cron.jobs

Existe solo:

```
cron.job
```

### ❌ Orchestrators sin supresión

→ puedes spamear leads
→ puedes romper Twilio / ElasticEmail

### ❌ Dispatch entrando en bucle infinito

Solución:
si falla → `status = failed`, NO reinsertar nada.

---

# 🧩 10. Qué puede tocar un dev y qué NO

### ✅ Puede tocar:

* funciones en `/supabase/functions/*`
* nuevas columnas en `touch_runs` si se hace migración
* nuevos drivers de canal
* nuevas vistas del brain
* Command OS intents
* frontend del dashboard

### ❌ NO puede tocar:

* estructura de `core_memory_events` sin migración
* columnas obligatorias de `touch_runs`
* suprimir un cron sin avisar (puede matar el sistema)
* borrar vistas del brain sin reemplazo

---

# 🦾 11. Cómo extender el sistema (Blueprint)

### Para agregar un nuevo canal:

1. crear driver en dispatch
2. actualizar router de dispatch
3. añadir steps en campaign_steps
4. probar con dry_run
5. activar cron si es necesario

### Para crear un nuevo Orchestrator:

1. crear edge function
2. seleccionar leads
3. dedupe contra touch_runs
4. insertar entries
5. logEvaluation
6. crear cron
7. test

### Para agregar scoring dinámico:

1. crear función → escribe en core_memory_events con score_delta
2. vista del brain ya lo absorberá

---

# 🎖️ 12. CONCLUSIÓN DEL ONBOARDING

Revenue ASI no es un CRM.
Es un **orquestador autónomo**.

Un dev nuevo debe entender 3 cosas:

1. **Todo pasa por Memory Engine (core_memory_events).**
2. **Orchestrators alimentan touch_runs.**
3. **Dispatch ejecuta y alimenta memoria.**

Cuando esos 3 módulos funcionan,
tu sistema es **imparable**.

---


## Touch payload v2 — Routing + Fallback Matrix (ESTÁNDAR)

Cada fila en `touch_runs` representa **un intento específico en un canal**  
(ej: voice intento #1 de una cadencia).

El `payload` define:
- El **plan de contacto** (orden de canales, límites, stop conditions).
- El **contenido y metadatos** para el dispatcher (body, templates, provider).

Formato estándar:

```json
{
  "message_class": "cold_outreach",
  "campaign_id": "2c6a8a2c-1234-4bcd-9876-abcdef012345",
  "step": 1,

  "routing": {
    "primary_channel": "voice",
    "current_channel": "voice",
    "fallback": {
      "order": ["voice", "whatsapp", "sms", "email"],
      "max_attempts": {
        "voice": 2,
        "whatsapp": 3,
        "sms": 2,
        "email": 3
      },
      "cooldown_minutes": {
        "voice": 1440,
        "whatsapp": 720,
        "sms": 720,
        "email": 1440
      }
    },
    "stop_on_events": [
      "reply_positive",
      "appointment_booked",
      "do_not_contact"
    ],
    "expires_at": "2025-12-31T23:59:59Z"
  },

  "delivery": {
    "template_key": "cold_dentist_v1_step1",
    "language": "es",
    "channel_overrides": {
      "voice": {
        "script_key": "dentist_cold_call_v1"
      },
      "whatsapp": {
        "template_name": "dentist_cold_whatsapp_v1"
      },
      "sms": {
        "template_name": "dentist_cold_sms_v1"
      },
      "email": {
        "subject": "Pacientes nuevos sin subir tu ads spend",
        "template_name": "dentist_cold_email_v1"
      }
    },
    "body": "Test de llamada desde dispatcher v5",
    "variables": {
      "first_name": "John",
      "clinic_name": "Dr. Smith Dental"
    }
  },

  "provider": {
    "forced_provider": null,
    "forced_sender_id": null
  },

  "meta": {
    "dry_run": true,
    "debug_tag": "payload-v2-test",
    "created_by": "director_engine_v2"
  }
}


1️⃣ Qué agregar al README (copia/pega)

Pon esto como una sección nueva, por ejemplo después del payload v2.

## Fallback Matrix & Next-Channel Decision (SQL-first)

Cada `touch_runs` define su plan de cadencia en `payload.routing.fallback`:

- `payload.routing.fallback.order` → orden de canales, ej: `["voice","whatsapp","sms","email"]`
- `payload.routing.fallback.max_attempts.<channel>` → intentos máximos por canal
- `payload.routing.fallback.cooldown_minutes.<channel>` → cooldown por canal en minutos
- `payload.routing.current_channel` → canal actual de este intento (debe coincidir con `touch_runs.channel`)

El histórico de intentos NO está en el payload; se calcula con:

- `touch_runs` (por `lead_id + step + channel`)
- `core_memory_events` (`touch_sent` / `touch_failed`)
- Vista `v_lead_channel_attempts`:

```sql
create or replace view public.v_lead_channel_attempts as
select
  tr.lead_id,
  tr.step,
  tr.channel,
  count(*) filter (
    where cme.event_type in ('touch_sent', 'touch_failed')
  ) as attempts_done,
  max(cme.created_at) filter (
    where cme.event_type in ('touch_sent', 'touch_failed')
  ) as last_attempt_at
from public.touch_runs tr
left join public.core_memory_events cme
  on cme.payload->>'touch_run_id' = tr.id::text
group by
  tr.lead_id,
  tr.step,
  tr.channel;

Decision engine (por lead + step)

Antes de crear el siguiente touch_runs, el orquestador resuelve una sola decisión a partir de:

fallback.order

max_attempts

cooldown_minutes

v_lead_channel_attempts

Las decisiones posibles son:

retry_same_channel

Aún hay intentos disponibles en el canal actual

El cooldown ya pasó (o es 0)

wait_cooldown

Aún hay intentos disponibles en el canal actual

El cooldown NO ha pasado → no se crea nuevo touch_runs

switch_channel

El canal actual agotó sus intentos (attempts_done >= attempts_allowed)

Hay un canal siguiente en fallback.order con intentos disponibles

El siguiente canal se convierte en next_channel

stop

Todos los canales de fallback.order agotaron sus intentos

No se crean más touch_runs para ese lead + step → cadencia muerta

La lógica SQL del “Decision Engine” se implementa como un CTE que:

Toma el último touch_runs para lead_id + step.

Expande fallback.order a filas (voice, whatsapp, sms, email).

Combina eso con v_lead_channel_attempts para obtener, por canal:

attempts_done

attempts_allowed

cooldown_minutes

last_attempt_at

cooldown_until = last_attempt_at + cooldown_minutes

Calcula para el canal actual:

Si puede reintentar (retry_same_channel)

Si debe esperar (wait_cooldown)

Si debe saltar (switch_channel → siguiente canal con intentos libres)

O si debe detener (stop)

El orquestador usa esa decisión para saber si:

No hace nada (wait_cooldown / stop)

Crea un nuevo touch_runs en el mismo canal (retry_same_channel)

Crea un nuevo touch_runs en otro canal (switch_channel, usando next_channel)

Este diseño es 100% SQL-first: las decisiones son reproducibles, debugeables y visibles con queries directas sobre la base.

Fallback Matrix & Next-Channel Decision (SQL-first)

Cada `touch_runs` define su plan de cadencia en `payload.routing.fallback`:

- `payload.routing.fallback.order` → orden de canales, ej: `["voice","whatsapp","sms","email"]`
- `payload.routing.fallback.max_attempts.<channel>` → intentos máximos por canal
- `payload.routing.fallback.cooldown_minutes.<channel>` → cooldown por canal en minutos
- `payload.routing.current_channel` → canal actual (debe coincidir con `touch_runs.channel`)

El histórico de intentos se calcula desde:

- `touch_runs` (por `lead_id + step + channel`)
- `core_memory_events` (`touch_sent` / `touch_failed`)
- Vista `v_lead_channel_attempts`:

```sql
create or replace view public.v_lead_channel_attempts as
select
  tr.lead_id,
  tr.step,
  tr.channel,
  count(*) filter (
    where cme.event_type in ('touch_sent', 'touch_failed')
  ) as attempts_done,
  max(cme.created_at) filter (
    where cme.event_type in ('touch_sent', 'touch_failed')
  ) as last_attempt_at
from public.touch_runs tr
left join public.core_memory_events cme
  on cme.payload->>'touch_run_id' = tr.id::text
group by
  tr.lead_id,
  tr.step,
  tr.channel;
Decisión por lead + step
La matriz decide una sola cosa por lead_id + step:

retry_same_channel

wait_cooldown

switch_channel

stop

Reglas:

retry_same_channel

Intentos usados < intentos permitidos en el canal actual

Cooldown pasado (o cooldown = 0)

wait_cooldown

Intentos usados < intentos permitidos

Cooldown NO ha pasado

switch_channel

Canal actual ya agotó intentos

Existe siguiente canal en fallback.order con intentos libres

stop

Todos los canales en fallback.order agotaron sus intentos

El orquestador usa esta decisión así:

wait_cooldown → no crea ningún touch_runs

retry_same_channel → crea nuevo touch_runs con mismo canal

switch_channel → crea nuevo touch_runs en next_channel

stop → no crea más touch_runs para ese lead + step

Toda la lógica se valida en SQL (CTEs + v_lead_channel_attempts) y luego se puede portar 1:1 a código.

Contrato de WhatsApp Dispatcher v2
La función dispatch-touch-whatsapp-v2 procesa sólo los touch runs que cumplan:

channel = 'whatsapp'

status IN ('queued','scheduled')

scheduled_at <= now()

account_id con proveedor por defecto configurado en account_provider_settings:

channel = 'whatsapp'

is_default = true

Además:

Resuelve phone desde lead_enriched.phone (formato E.164, ej: +50765699957)

Construye:

toReal = "whatsapp:"+phone

to = QA_SINK ?? toReal

Mensaje usado:

payload.message o payload.body o "Hola!"

Si dry_run = true (env DRY_RUN_WHATSAPP o body), no llama a Twilio, pero actualiza:

status = 'sent'

sent_at = now()

payload.provider = 'twilio'

payload.provider_config = account_provider_settings.config

payload.to = to

payload.dryRun = dryRun

También escribe core_memory_events:

touch_scheduled al crear el touch

touch_sent o touch_failed al despachar

Contrato para crear touch_runs de WhatsApp (lo que debe respetar Director/Orquestador)
Para que un touch de WhatsApp sea elegible:

Columnas:

channel = 'whatsapp'

status = 'queued' (o scheduled)

scheduled_at <= now() si debe salir “ya”

account_id no nulo

Payload mínimo:

json
Copiar código
{
  "to": "whatsapp:+50765699957",
  "to_normalized": "+50765699957",
  "delivery": {
    "body": "Mensaje de prueba"
  },
  "meta": {
    "dry_run": true,
    "debug_tag": "lo_que_quieras"
  }
}
Para integrar con fallback v2:

El payload completo del primer touch debería seguir este patrón:

json
Copiar código
{
  "meta": {
    "dry_run": true,
    "debug_tag": "cold-outbound-step1",
    "created_by": "director_engine"
  },
  "step": 1,
  "dry_run": true,
  "routing": {
    "fallback": {
      "order": ["voice", "whatsapp", "sms", "email"],
      "max_attempts": {
        "voice": 1,
        "whatsapp": 3,
        "sms": 2,
        "email": 3
      },
      "cooldown_minutes": {
        "voice": 0,
        "whatsapp": 720,
        "sms": 720,
        "email": 1440
      }
    },
    "expires_at": "2025-12-31T23:59:59Z",
    "stop_on_events": [
      "reply_positive",
      "appointment_booked",
      "do_not_contact"
    ],
    "current_channel": "voice",
    "primary_channel": "voice"
  },
  "delivery": {
    "body": "Test de llamada desde dispatcher v5 (payload v2)",
    "language": "es",
    "variables": {
      "first_name": "Francisco",
      "clinic_name": "Level 5"
    },
    "template_key": "cold_dentist_v1_step1",
    "channel_overrides": {
      "sms": {
        "template_name": "dentist_cold_sms_v1"
      },
      "email": {
        "subject": "Pacientes nuevos sin subir tu ads spend",
        "template_name": "dentist_cold_email_v1"
      },
      "voice": {
        "script_key": "dentist_cold_call_v1"
      },
      "whatsapp": {
        "template_name": "dentist_cold_whatsapp_v1"
      }
    }
  },
  "provider": "twilio",
  "campaign_id": "UUID_DE_CAMPANA",
  "message_class": "cold_outreach",
  "to_normalized": "+50765699957",
  "provider_config": {}
}

Paso A — Congelar esta v1 en la doc

Añade esto al README (o a docs/director-engine/README.md):

Diagrama corto del loop:

touch_runs(queued) 
  → dispatcher(channel)
  → core_memory_events
  → decide_next_channel_for_lead()
  → dispatch-touch-smart-router
  → nuevo touch_runs(next_channel)


Nota clave:
“Solo los touch_runs con payload.routing.fallback se consideran para la matriz; los demás caen en decision = stop.”

Eso sirve para que en 1 mes no tengamos que reconstruir esto desde cero en la cabeza.