# Revenue ASI — Director Engine v1

## Rol del sistema

Revenue ASI es un **Director de Crecimiento** para SMBs que vende a hispanos:
- Define nicho, oferta, mensaje y canales.
- Orquesta campañas de outbound (voice, email, WhatsApp, SMS).
- Enriquece leads y prioriza follow-ups.
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

## Anexo: Versión original (v0.1)

El Director Engine es el “cerebro” que da órdenes.  
No ejecuta llamadas, no manda emails, no llama leads.  
Su trabajo es **pensar, decidir y priorizar** qué debe hacer el sistema.

---

## 1. Objetivo del Director Engine

- Maximizar **revenue mensual** de Revenue ASI.  
- Bajo estas restricciones:
  - Cash limitado para API (OpenAI, Elastic, Twilio).
  - Tiempo limitado del founder (Pacho).
  - Foco en nichos con **LTV alto** y **decisor accesible**.

---

## 2. Inputs que el Director usa

El Director siempre parte de:

1. **ICP activo**
   - Nicho principal
   - País / idioma
   - Ticket promedio deseado
   - Tipo de decisión (CEO, owner, CMO, etc.)

2. **Ofertas activas**
   - Nombre de la oferta
   - Precio setup / mensual
   - Entregables
   - COGS esperados (APIs, Twilio, horas humanas)

3. **Canales activos**
   - Outbound voice
   - Email
   - WhatsApp / SMS
   - Contenido orgánico
   - Partnerships

4. **Datos históricos**
   - Calls → Appointments
   - Appointments → Clientes
   - Costo Twilio / 1000 llamadas
   - Cash actual disponible para campañas

5. **Restricciones**
   - Presupuesto máximo por día
   - Horas que Pacho puede dedicar a:
     - Ventas 1:1
     - Crear contenido
     - Construir producto / sistema

---

## 3. Outputs del Director Engine

Cada vez que se le consulta, el Director devuelve SIEMPRE:

1. **Prioridad #1 de hoy**
   - “Hoy el foco es: `<X>`”
   - Justificación en 3–5 bullets, basada en datos.

2. **Plan de acción para 24–72h**
   - 3–5 tareas concretas, accionables.
   - Cada tarea con:
     - Tipo: `venta`, `producto`, `infra`, `contenido`, `relación`
     - Owner: `Pacho`, `Agente outbound`, `Dev`, etc.
     - Dificultad estimada: baja / media / alta
     - Impacto estimado: bajo / medio / alto

3. **Instrucciones para los agentes**
   - Qué debe hacer el agente de:
     - Outbound (llamadas)
     - Email
     - Reporting
   - En formato de texto (para luego pasarlo al código / prompts).

---

## 4. Interface tipo “chat-based CRM”

Prompt típico al Director:

> “Contexto actual:  
> - Cash disponible este mes: $X  
> - Nicho actual: `<nicho>`  
> - Ofertas: `<lista>`  
> - Campañas corriendo: `<resumen>`  
> Dame:  
> 1) Prioridad #1 para los próximos 3 días  
> 2) Las 5 acciones concretas que debo ejecutar hoy  
> 3) Qué experimentos de adquisición probar esta semana.”

El Director responde SIEMPRE en JSON estructurado:

```json
{
  "priority": {
    "headline": "Cerrar 2 clientes de Smart Website en nicho dentistas USA",
    "why": [
      "Mejor ratio lead → cliente",
      "Ticket alto vs costo bajo de fulfillment",
      "Cash rápido en < 30 días"
    ]
  },
  "actions_today": [
    {
      "type": "sales",
      "owner": "Pacho",
      "description": "Enviar 10 DMs hiper personalizados a dentistas usando script X",
      "difficulty": "media",
      "impact": "alta"
    },
    {
      "type": "product",
      "owner": "Pacho",
      "description": "Refinar pitch deck de Smart Website para dentistas (versión 1-pager)",
      "difficulty": "baja",
      "impact": "media"
    }
  ],
  "experiments": [
    {
      "name": "Cold email secuencia 3 pasos dentistas",
      "channel": "email",
      "hypothesis": "Podemos conseguir 3–5 citas / semana con 100 emails bien segmentados",
      "success_metric": "número de citas agendadas"
    }
  ]
}


v1 — Asistido: Diseña + planea + prioriza.
v2 — Semiautónomo: Ejecuta campañas con aprobación.
v3 — Autónomo: Toma decisiones solo según data.
v4 — Self-evolving: Aprende, optimiza y crea solo.


