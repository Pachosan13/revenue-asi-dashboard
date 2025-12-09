"use client"

import React from "react"

export type BrainResponse = {
  ok: boolean
  intent: string
  explanation?: string
  args?: Record<string, any>
  data?: any
}

export default function BrainResponseTranslator({
  response,
}: {
  response: BrainResponse | null
}) {
  if (!response) return null

  const { ok, intent, args, data } = response

  const lead = data?.lead
  const leads = data?.leads as any[] | undefined

  // ------------------------
  // TEXTO HUMANO
  // ------------------------
  const renderHuman = () => {
    // 1) lead.inspect
    if (intent === "lead.inspect") {
      if (!ok && data?.error) {
        return (
          <>
            <p className="text-red-400 font-semibold mb-2">
              No pude identificar al lead.
            </p>
            <p className="text-emerald-100 text-sm">
              Intenta de nuevo usando email, teléfono o nombre completo.
            </p>
          </>
        )
      }

      if (ok && lead) {
        const name =
          lead.contact_name ||
          lead.full_name ||
          lead.company_name ||
          lead.email ||
          "Lead sin nombre"

        return (
          <div className="space-y-1">
            <p className="text-emerald-300 font-semibold text-base">
              Lead encontrado: {name}
            </p>
            {lead.email && (
              <p className="text-sm text-emerald-100">
                <span className="font-semibold">Email:</span> {lead.email}
              </p>
            )}
            {lead.phone && (
              <p className="text-sm text-emerald-100">
                <span className="font-semibold">Teléfono:</span> {lead.phone}
              </p>
            )}
            <p className="text-sm text-emerald-100">
              <span className="font-semibold">Estado:</span>{" "}
              {lead.state || lead.status || "sin estado"}
            </p>
            {typeof lead.score === "number" && (
              <p className="text-sm text-emerald-100">
                <span className="font-semibold">Score:</span> {lead.score}
              </p>
            )}
            <p className="text-sm text-emerald-200 mt-2">
              <span className="font-semibold">Recomendación:</span>{" "}
              {lead.state === "new"
                ? "Inicia un primer contacto por WhatsApp con un mensaje corto y directo."
                : "Continúa la secuencia de la campaña y revisa el historial antes de contactar."}
            </p>
          </div>
        )
      }

      return (
        <p className="text-sm text-emerald-100">
          No encontré información útil para ese lead.
        </p>
      )
    }

    // 2) lead.enroll
    if (intent === "lead.enroll") {
      if (!ok) {
        return (
          <>
            <p className="text-red-400 font-semibold mb-1">
              No se pudo enrolar el lead.
            </p>
            <p className="text-sm text-emerald-100">
              {data?.error ||
                "Revisa que el lead exista y que la campaña sea válida."}
            </p>
          </>
        )
      }

      const campaignName =
        args?.campaign_name || data?.campaign_name || "campaña seleccionada"

      return (
        <div className="space-y-2">
          <p className="text-emerald-300 font-semibold">
            Lead enrolado correctamente.
          </p>
          <p className="text-sm text-emerald-100">
            Quedó dentro de la campaña <span className="font-semibold">
              {campaignName}
            </span>
            .
          </p>
          <p className="text-sm text-emerald-200">
            El orquestador decidirá los próximos toques (canal, timing y
            mensajes) según las reglas que tengas configuradas.
          </p>
        </div>
      )
    }

    // 3) lead.update
    if (intent === "lead.update") {
      if (!ok) {
        return (
          <>
            <p className="text-red-400 font-semibold mb-1">
              No pude actualizar el lead.
            </p>
            <p className="text-sm text-emerald-100">
              {data?.error || "Revisa los campos que intentas cambiar."}
            </p>
          </>
        )
      }

      return (
        <div className="space-y-1">
          <p className="text-emerald-300 font-semibold">
            Cambios aplicados al lead.
          </p>
          <p className="text-sm text-emerald-100">
            Los datos quedaron guardados en la base. Los siguientes toques
            usarán esta versión actualizada.
          </p>
        </div>
      )
    }

    // 4) lead.list.recents
    if (intent === "lead.list.recents") {
      if (!ok) {
        return (
          <>
            <p className="text-red-400 font-semibold mb-1">
              No pude cargar los leads recientes.
            </p>
            <p className="text-sm text-emerald-100">
              {data?.error || "Intenta ajustar los filtros o el rango de tiempo."}
            </p>
          </>
        )
      }

      if (!leads || leads.length === 0) {
        return (
          <p className="text-sm text-emerald-100">
            No hay leads recientes con esos criterios.
          </p>
        )
      }

      return (
        <div className="space-y-2">
          <p className="text-emerald-300 font-semibold">
            Últimos {leads.length} leads en la cuenta:
          </p>
          <ul className="space-y-1">
            {leads.map((l, idx) => (
              <li
                key={l.id || idx}
                className="text-sm text-emerald-100 flex justify-between gap-2"
              >
                <span>
                  {l.contact_name || l.company_name || l.email || "Sin nombre"}
                </span>
                <span className="text-xs text-emerald-400">
                  {l.state || l.status || "sin estado"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )
    }

    // 5) system.status
    if (intent === "system.status") {
      if (!ok) {
        return (
          <>
            <p className="text-red-400 font-semibold mb-1">
              No pude leer el estado del sistema.
            </p>
            <p className="text-sm text-emerald-100">
              {data?.error || "Revisa las conexiones principales."}
            </p>
          </>
        )
      }

      return (
        <div className="space-y-1">
          <p className="text-emerald-300 font-semibold">
            El sistema está operativo.
          </p>
          <p className="text-sm text-emerald-100">
            El wiring de Command OS responde correctamente. Falta solo conectar
            proveedores y health checks más profundos.
          </p>
        </div>
      )
    }

    // 6) fallback
    if (!ok && data?.error) {
      return (
        <p className="text-sm text-emerald-100">
          {data.error as string}
        </p>
      )
    }

    return (
      <p className="text-sm text-emerald-100">
        Comando ejecutado. No hay más detalles relevantes para mostrar.
      </p>
    )
  }

  return (
    <div className="p-4 bg-black/60 text-emerald-50 rounded-xl border border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.35)]">
      <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-400 mb-2">
        Resumen humano
      </div>
      {renderHuman()}
    </div>
  )
}
