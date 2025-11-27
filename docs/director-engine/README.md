# Revenue ASI — Director Engine v1

## Rol del sistema

Revenue ASI es un **Director de Crecimiento** para SMBs que vende a hispanos:
- Define nicho, oferta, mensaje y canales.
- Orquesta campañas de outbound (voice, email, WhatsApp, SMS).
- Enriquce leads y prioriza follow-ups.
- Alimenta un CRM basado en conversaciones, no en campos.

> Meta: 10–20 citas calificadas por mes por cliente, con margen alto y operación lo más autónoma posible.

---

## 1. ICP actual (primer foco)

### Tipo de cliente
- SMBs en USA que venden a mercado hispano.
- Nichos prioritarios (v1): **dealers de autos**, **dentistas**, **financial loaners**, **agencias de marketing**.

### Tamaño
- 3–50 empleados.
- Dueño todavía metido en ventas.

---

## 2. Arquitectura mental del sistema

1. **Input**
   - Listas de leads (csv, Google Sheet, CRM externo).
   - Parámetros de campaña (nicho, oferta, mercado, objetivo de citas/día).
   - Preferencias del cliente (horarios, tono, canales permitidos).

2. **Director Engine**
   - Define estrategia: nicho + promesa + canal principal + secuencia.
   - Genera campañas: scripts de voz, emails, WhatsApp, SMS.
   - Decide qué leads atacar primero (priorización por intent, señal, fit).
   - Ajusta según resultados (más llamadas, más email, cambiar mensajes, etc).

3. **Execution Layer (más adelante)**
   - Voice SDR (Twilio).
   - Email (Elastic / otro).
   - WhatsApp / SMS.
   - Integraciones con CRM externo si aplica.

4. **Output**
   - Citas agendadas.
   - Pipeline de leads con estado claro.
   - Reporte de KPIs de campaña (calls, contacts, appointments, shows, closes).

---

## 3. Módulos del Director Engine (sin código todavía)

### 3.1. Campaign Designer
- Toma: nicho + oferta + ICP.
- Devuelve:
  - Mensaje central.
  - 1 promesa principal + 2 secundarias.
  - 1 ángulo de urgencia.
  - 1 objeción principal + respuesta.

### 3.2. Outreach Orchestrator
- Define:
  - Cadencia de canales: voz + email + WhatsApp.
  - Número de toques por lead y timing.
  - Reglas de pausa (no seguir insistiendo si X).

### 3.3. Lead Enrichment Planner
- Define:
  - Qué datos mínimos necesita por lead (email, phone, website, etc).
  - De dónde sacarlos (scraping / APIs).
  - Cómo guardarlos (schema de lead).

### 3.4. CRM Conversacional (v1 concept)
- El CRM se piensa así:
  - Cada lead = hilo de conversación.
  - Todo se controla por chat tipo:
    - “Muéstrame leads calientes de los últimos 3 días.”
    - “Crea campaña para 20 citas al mes con dentistas en Florida.”
- El “director” responde con:
  - Plan.
  - Estado.
  - Acciones disparadas.

---

## 4. Roadmap técnico (cuando haya APIs y budget)

1. Conectar OpenAI API.
2. Conectar Twilio (voz).
3. Conectar proveedor de email.
4. Guardar todo en Supabase con esquema:
   - `leads`
   - `campaigns`
   - `campaign_runs`
   - `touches`
   - `appointments`

---

## 5. Estado actual

- Este documento es la **fuente de verdad** del producto.
- Google Docs es solo borrador; aquí va lo oficial.
- Hasta que haya budget para API, seguimos:
  - Refinando prompts.
  - Refinando módulos.
  - Definiendo esquemas de datos.
  - Diseñando el CRM basado en chat.


## lead_enriched — Contract

`lead_enriched` es una vista SQL que enriquece los leads con el último touch y metadatos de campaña usando únicamente tablas existentes (`leads`, `touch_runs`, `campaigns`). Sirve como fuente principal para Leads Inbox y Leads Page.

Columnas expuestas:
- `id` — Identificador del lead.
- `full_name` — Nombre calculado combinando `lead_enriched.name`, `leads.contact_name` o `leads.company_name`.
- `email` — Email del lead.
- `phone` — Teléfono del lead.
- `state` — Estado actual del lead.
- `last_touch_at` — Fecha/hora del último touch.
- `campaign_id` — Campaña del último touch.
- `campaign_name` — Nombre de la campaña.
- `channel_last` — Canal del último touch.

Expectativa del Leads Inbox / Leads Page:
- Consumir `supabase.from("lead_enriched").select("*")`.
- Mostrar `state` como status y permitir filtros por este campo.
- Usar `last_touch_at`, `campaign_name` y `channel_last` para contexto del último contacto.
- Si la vista falla, caer a mocks y mostrar banner de error.
