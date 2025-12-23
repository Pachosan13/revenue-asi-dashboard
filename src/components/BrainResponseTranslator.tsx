"use client"

import React from "react"

export type BrainResponse = {
  ok: boolean
  intent: string
  explanation?: string
  args?: Record<string, any>
  data?: any
}

function Title({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold text-slate-900">{children}</div>
}

function Subtle({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] text-slate-600">{children}</div>
}

function KeyVal({
  k,
  v,
}: {
  k: string
  v: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="text-[12px] text-slate-500">{k}</div>
      <div className="text-[12px] text-slate-900 text-right break-all">{v}</div>
    </div>
  )
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode
  tone?: "neutral" | "ok" | "warn" | "bad"
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : tone === "bad"
          ? "bg-red-50 text-red-700 border-red-200"
          : "bg-slate-50 text-slate-700 border-slate-200"

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] ${cls}`}
    >
      {children}
    </span>
  )
}

/* -------------------- helpers (robust) -------------------- */

function s(v: any, fallback = "") {
  if (v === null || v === undefined) return fallback
  const str = String(v).trim()
  return str ? str : fallback
}

function n(v: any) {
  const num = Number(v)
  return Number.isFinite(num) ? num : null
}

function pickFirst<T = any>(...vals: any[]): T | null {
  for (const v of vals) {
    if (v !== null && v !== undefined) return v as T
  }
  return null
}

function arr(v: any): any[] {
  return Array.isArray(v) ? v : []
}

function getError(data: any, fallback = "Ocurrió un error.") {
  return (
    s(data?.error) ||
    s(data?.message) ||
    s(data?.detail) ||
    s(data?.hint) ||
    fallback
  )
}

function getLeadName(lead: any) {
  return (
    s(lead?.contact_name) ||
    s(lead?.full_name) ||
    s(lead?.lead_name) ||
    s(lead?.company_name) ||
    s(lead?.company) ||
    s(lead?.email) ||
    "Lead sin nombre"
  )
}

function getLeadState(lead: any) {
  return s(lead?.state) || s(lead?.status) || s(lead?.lead_state) || "—"
}

function getLeadScore(lead: any) {
  return (
    n(lead?.score) ??
    n(lead?.priority_score) ??
    n(lead?.lead_brain_score) ??
    null
  )
}

/** data.lead puede venir en distintas formas */
function normalizeLead(data: any) {
  const lead =
    data?.lead ??
    data?.row ??
    data?.item ??
    (data && typeof data === "object" && (data.email || data.phone || data.id) ? data : null)

  return lead && typeof lead === "object" ? lead : null
}

/** data.leads puede venir como leads | rows | items | data (array) */
function normalizeLeads(data: any) {
  const maybe =
    data?.leads ??
    data?.rows ??
    data?.items ??
    (Array.isArray(data) ? data : null)

  return Array.isArray(maybe) ? maybe : []
}

/* -------------------- component -------------------- */

export default function BrainResponseTranslator({
  response,
}: {
  response: BrainResponse | null
}) {
  if (!response) return null

  const { ok, intent, args, data, explanation } = response

  const lead = normalizeLead(data)
  const leads = normalizeLeads(data)

  const renderHuman = () => {
    // 0) lead.inspect.latest (tratamos igual que inspect)
    if (intent === "lead.inspect.latest") {
      if (!ok) {
        return (
          <div className="space-y-2">
            <Title>No pude traer el último lead</Title>
            <Subtle>{getError(data, "Hubo un error resolviendo el último lead.")}</Subtle>
          </div>
        )
      }

      if (ok && lead) {
        const name = getLeadName(lead)

        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Title>Último lead</Title>
              <Badge tone="ok">OK</Badge>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              <KeyVal k="Nombre" v={name} />
              <KeyVal k="Email" v={s(lead.email, "—")} />
              <KeyVal k="Teléfono" v={s(lead.phone, "—")} />
              <KeyVal k="Estado" v={getLeadState(lead)} />
              {getLeadScore(lead) !== null ? (
                <KeyVal k="Score" v={getLeadScore(lead) as number} />
              ) : null}
            </div>

            <Subtle>
              Siguiente: escribe “envíale el siguiente touch” o “enróllalo en campaña X”.
            </Subtle>
          </div>
        )
      }

      return (
        <div className="space-y-2">
          <Title>No hay info útil del último lead</Title>
          <Subtle>Prueba “lista los últimos 10 leads”.</Subtle>
        </div>
      )
    }

    // 1) lead.inspect
    if (intent === "lead.inspect") {
      if (!ok) {
        return (
          <div className="space-y-2">
            <Title>No pude identificar al lead</Title>
            <Subtle>{getError(data, "Intenta con email o teléfono (mejor que nombre).")}</Subtle>
          </div>
        )
      }

      if (ok && lead) {
        const name = getLeadName(lead)

        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Title>Lead encontrado</Title>
              <Badge tone="ok">OK</Badge>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              <KeyVal k="Nombre" v={name} />
              <KeyVal k="Email" v={s(lead.email, "—")} />
              <KeyVal k="Teléfono" v={s(lead.phone, "—")} />
              <KeyVal k="Estado" v={getLeadState(lead)} />
              {getLeadScore(lead) !== null ? (
                <KeyVal k="Score" v={getLeadScore(lead) as number} />
              ) : null}
            </div>

            <Subtle>
              Siguiente: “envíale el siguiente touch” o “enróllalo en campaña X”.
            </Subtle>
          </div>
        )
      }

      return (
        <div className="space-y-2">
          <Title>No encontré info útil</Title>
          <Subtle>Ese lead no devolvió data usable.</Subtle>
        </div>
      )
    }

    // 2) lead.enroll
    if (intent === "lead.enroll") {
      if (!ok) {
        return (
          <div className="space-y-2">
            <Title>No se pudo enrolar el lead</Title>
            <Subtle>{getError(data, "Revisa que el lead exista y que la campaña sea válida.")}</Subtle>
          </div>
        )
      }

      const campaignName =
        s(args?.campaign_name) || s(data?.campaign_name) || "campaña seleccionada"

      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Title>Enrolado completo</Title>
            <Badge tone="ok">OK</Badge>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <KeyVal k="Campaña" v={campaignName} />
          </div>

          <Subtle>
            El orquestador decide próximos toques (canal, timing, mensajes) según reglas.
          </Subtle>
        </div>
      )
    }

    // 3) lead.update
    if (intent === "lead.update") {
      if (!ok) {
        return (
          <div className="space-y-2">
            <Title>No pude actualizar el lead</Title>
            <Subtle>{getError(data, "Revisa los campos permitidos.")}</Subtle>
          </div>
        )
      }

      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Title>Cambios aplicados</Title>
            <Badge tone="ok">OK</Badge>
          </div>
          <Subtle>
            Guardado en base. Los siguientes toques usan esta versión.
          </Subtle>
        </div>
      )
    }

    // 4) lead.list.recents
    if (intent === "lead.list.recents") {
      if (!ok) {
        return (
          <div className="space-y-2">
            <Title>No pude cargar leads recientes</Title>
            <Subtle>{getError(data, "Ajusta filtros (status/state) o baja el limit.")}</Subtle>
          </div>
        )
      }

      if (!leads || leads.length === 0) {
        return (
          <div className="space-y-2">
            <Title>No hay leads con esos criterios</Title>
            <Subtle>Prueba sin filtros o con limit más alto.</Subtle>
          </div>
        )
      }

      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Title>Leads recientes</Title>
            <Badge tone="neutral">{leads.length}</Badge>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <ul className="divide-y divide-slate-200">
              {leads.slice(0, 12).map((l, idx) => {
                const name =
                  s(l?.contact_name) ||
                  s(l?.lead_name) ||
                  s(l?.company_name) ||
                  s(l?.company) ||
                  s(l?.email) ||
                  "Sin nombre"
                const st =
                  s(l?.state) ||
                  s(l?.status) ||
                  s(l?.lead_state) ||
                  s(l?.lead_brain_bucket) ||
                  "—"
                const key = pickFirst(l?.id, l?.lead_id, `${idx}`) as any

                return (
                  <li
                    key={key}
                    className="px-3 py-2 flex items-center justify-between gap-3"
                  >
                    <div className="text-[12px] text-slate-900 truncate">
                      {name}
                    </div>
                    <div className="text-[11px] text-slate-500 shrink-0">
                      {st}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          <Subtle>Tip: “inspecciona el último lead”.</Subtle>
        </div>
      )
    }

    // 5) system.status
    if (intent === "system.status") {
      if (!ok) {
        return (
          <div className="space-y-2">
            <Title>No pude leer el estado del sistema</Title>
            <Subtle>{getError(data, "Revisa conexiones principales.")}</Subtle>
          </div>
        )
      }

      const checks = Array.isArray(data?.checks) ? data.checks : null

      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Title>Estado del sistema</Title>
            <Badge tone="ok">OK</Badge>
          </div>

          {checks ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              {arr(checks).slice(0, 12).map((c: any, idx: number) => {
                const st = String(c?.status ?? "unknown").toLowerCase()
                const tone =
                  st === "ok" || st === "configured"
                    ? "ok"
                    : st === "warn" || st === "warning"
                      ? "warn"
                      : st === "fail" || st === "error"
                        ? "bad"
                        : "neutral"

                return (
                  <div key={idx} className="flex items-center justify-between gap-3">
                    <div className="text-[12px] text-slate-900">
                      {c?.name ? String(c.name) : "check"}
                      {c?.message ? (
                        <span className="text-slate-500"> — {String(c.message)}</span>
                      ) : null}
                    </div>
                    <Badge tone={tone as any}>
                      {String(c?.status ?? "unknown").toUpperCase()}
                    </Badge>
                  </div>
                )
              })}
            </div>
          ) : (
            <Subtle>OK (sin checks detallados)</Subtle>
          )}
        </div>
      )
    }

    // fallback error
    if (!ok && (data?.error || data?.message)) {
      return (
        <div className="space-y-2">
          <Title>Falló la ejecución</Title>
          <Subtle>{String(getError(data, "Error desconocido"))}</Subtle>
        </div>
      )
    }

    // generic fallback
    return (
      <div className="space-y-2">
        <Title>Comando ejecutado</Title>
        <Subtle>No hay más detalles relevantes para mostrar.</Subtle>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
          Resumen
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={ok ? "ok" : "bad"}>{ok ? "OK" : "ERROR"}</Badge>
          <span className="text-[11px] text-slate-500 font-mono">{intent}</span>
        </div>
      </div>

      {renderHuman()}

      {explanation ? (
        <div className="mt-4 pt-3 border-t border-slate-200">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 mb-1">
            Nota del brain
          </div>
          <div className="text-[12px] text-slate-700 whitespace-pre-wrap">
            {explanation}
          </div>
        </div>
      ) : null}
    </div>
  )
}
