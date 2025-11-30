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

# Revenue ASE – Self-improving SDR Agent

Revenue ASE es un agente SDR que vive encima de Supabase y un dashboard en Next.js.  
Su única obsesión: **calificar leads y convertirlos en citas** (appointments) por todos los canales posibles.

Core idea:

> El motor se mejora solo con cada iteración, cada llamada, cada mensaje y cada cita que agenda.

---

## 1. Visión

Revenue ASE debe ser capaz de:

- Tomar un **ranking de leads** y decidir a quién contactar primero.
- Hacer outreach por **voz (Twilio Voice), WhatsApp, SMS y email**.
- Entender respuestas (intents) y actualizar el estado del lead.
- **Calificar** al lead y **empujarlo a una cita** (calendario).
- Crear y gestionar **appointments** en un calendario real (Gmail / GHL / Calendly).
- Enviar **recordatorios** de citas por WhatsApp, SMS y email.
- Aprender de su propio histórico de llamadas y mensajes para mejorar cadencias, copy y priorización.

---

## 2. Arquitectura de alto nivel

Repos:

- `revenue-asi/` → Supabase (DB, funciones Edge, cron).
- `revenue-asi-dashboard/` → UI de operador (Leads Inbox, Appointments Cockpit, Dashboard).

Capas:

1. **Ingesta de leads**
   - Tablas: `lead_raw`, `lead_enriched`.
   - Fuentes: scrapers, imports, APIs externas (futuro).
2. **Orquestación de cadencias**
   - Tabla: `touch_runs` (plan) + `touches` (histórico).
   - Edge function: `touch-orchestrator-v4` (pronto v5 idempotente).
3. **Entrega de mensajes**
   - Providers reales: Twilio, Elastic Email, WhatsApp provider.  
   - Provider mock: simula envíos para testing sin costo.
4. **Voice SDR**
   - Tablas: `voice_calls`, `lead_events`.
   - Funciones: `voice-agent`, `voice-webhook` (procesa llamadas y transcript).
5. **Bookings**
   - Tabla: `appointments`.
   - Función: `appointment-webhook` / integración calendario.
6. **Director Console**
   - Dashboard de control: reply rate, meetings booked, error rate, throughput.

---

## 3. Modelo de datos (versión resumida)

Principales tablas / views:

- `lead_enriched`
  - `id`
  - `full_name`
  - `email`
  - `phone`
  - `state` (null | attempting | completed | booked | dead, etc.)
  - `last_touch_at`
  - `channel_last`
  - + campos de enriquecimiento (industria, país, tags, score, etc.)

- `touch_runs`
  - `id`
  - `lead_id`
  - `campaign_id`
  - `campaign_run_id`
  - `channel` (email | sms | whatsapp | voice)
  - `type` (sequence, manual, system, etc.)
  - `status` (queued | sent | failed | error | stopped)
  - `step`
  - `payload` (JSON con subject, body, template, etc.)
  - `scheduled_at`
  - `sent_at`
  - `created_at`
  - `error`
  - `meta`

- `touches`
  - Histórico “real” de toques entregados, con FK a `lead_id` y `touch_runs.id`.

- `voice_calls`
  - `id`
  - `lead_id`
  - `status` (queued | completed | failed)
  - `provider_call_id`
  - `meta` (incluye `voice_webhook.transcript`, `voice_webhook.intent`)
  - `updated_at`

- `lead_events`
  - `id`
  - `lead_id`
  - `event_type` (voice_completed, appointment_created, reply_email, reply_whatsapp, etc.)
  - `payload` (JSON con detalles; transcript, intent, metadata del provider)
  - `created_at`

- `appointments`
  - `id`
  - `lead_id`
  - `scheduled_for`
  - `status` (scheduled | completed | cancelled | no_show)
  - `channel` (zoom | in_person | phone)
  - `created_by` (appointment-webhook, manual, etc.)

---

## 4. Flujo end-to-end (ideal)

1. **Ingesta & ranking**
   - Nuevos leads entran a `lead_raw`.
   - Proceso de enriquecimiento llena `lead_enriched`.
   - Ranking por score / intent / atributos.

2. **Orquestación**
   - `campaign-engine` decide quién entra a cada campaña.
   - `touch-orchestrator-v4/v5`:
     - Selecciona `lead_enriched` con `state` null o `attempting`.
     - Inserta `touch_runs` con la cadencia (email → sms → voice → whatsapp).
     - Mantiene un estado por lead + campaña.

3. **Entrega**
   - En modo real: proveedores Twilio / WhatsApp / Email.
   - En modo mock: función `provider-mock`:
     - Lee `touch_runs` con `status = queued`.
     - Simula envíos → marca `status = sent`, llena `sent_at`.
     - Inserta en `touches` y `lead_events`.

4. **Voice SDR**
   - Para toques `voice`:
     - Se crea un registro en `voice_calls`.
     - `voice-agent` gestiona el diálogo (Twilio + OpenAI).
     - `voice-webhook` guarda transcript + intent en `voice_calls.meta` y registra `lead_events` (`voice_completed`).

5. **Calificación & citas**
   - Si intent = “interested” / “book_call”:
     - Se dispara `appointment-webhook` que crea un `appointment` (usando el calendario conectado).
     - `lead_enriched.state` se actualiza a `booked`.
     - `touch-orchestrator` detiene la cadencia para ese lead.

6. **Recordatorios**
   - Jobs que miran `appointments`:
     - Envían recordatorios por WhatsApp, SMS y email antes de la cita.
     - Registran `lead_events` tipo `appointment_reminder_sent`.

7. **Feedback loop**
   - Métricas:
     - Reply rate por canal.
     - Meetings booked por campaña.
     - Error rate.
   - El motor ajusta automáticamente:
     - timing de cadencias,
     - copy,
     - priorización de segmentos.

---

## 5. Estado actual (re-ensamblaje)

### ✅ Ya construido / funcionando

- `lead_enriched` + `touch_runs` + `voice_calls` + `appointments` + `lead_events` tablas presentes.
- `touch-orchestrator-v4`:
  - Selecciona leads no booked desde `lead_enriched` usando `state`.
  - Inserta `touch_runs` en bulk.
- UI (`revenue-asi-dashboard`):
  - **Leads Inbox**:
    - Lista leads con `state` y acciones.
    - Modal de lead con timeline de `touch_runs` + `voice_calls` + `appointments` + `lead_events`.
  - **Appointments Cockpit**:
    - Ver próximos bookings (mock).
  - **Dashboard (Operating Picture)**:
    - Series de leads/touches/errores (con fallback mock).

### 🟡 Parcialmente hecho

- Actualización de `lead_enriched.state` a `completed` / `booked` desde eventos reales.
- `appointment-webhook` / integración real de calendario.
- Mapeo completo de intents de voz → acciones (book call, not interested, call later, etc.).

### 🔴 Pendiente

- Provider mock (simulador de Twilio/WhatsApp/SMS/Email).
- Orchestrator v5 idempotente (sin duplicados, seguro vs corridas múltiples).
- Recordatorios automáticos de appointments (WhatsApp/SMS/email).
- Motor de ranking de leads (priorización por score + intent + edad del lead).
- Auto-optimización de cadencias (usar métricas para afinar horarios y canales).

---

## 6. Roadmap de implementación

Orden sugerido:

1. **Documentar contrato de datos (este README) – v1**
2. **Cerrar loop STATE:**
   - `voice_completed` → `lead_enriched.state = 'completed'`
   - `appointment_created` → `lead_enriched.state = 'booked'`
3. **Provider mock:**
   - Edge function que procesa `touch_runs.status = 'queued'`
   - Simula envíos, llena `sent_at`, inserta en `touches` y `lead_events`.
4. **Dry run de 20–50 leads en modo mock**
5. **Orchestrator v5 idempotente**
6. **Integrar calendario real**
7. **Recordatorios automáticos de citas**
8. **Ranking de leads + auto-optimización**

---
