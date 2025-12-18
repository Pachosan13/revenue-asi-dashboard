"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import BrainResponseTranslator, { BrainResponse } from "@/components/BrainResponseTranslator"

type CommandOsWireResponse = {
  ok: boolean
  intent: string
  explanation: string
  confidence: number
  version: string
  assistant_message?: string
  artifacts?: BrainResponse
}

type ChatMsg =
  | { role: "user"; ts: number; text: string }
  | { role: "assistant"; ts: number; payload: CommandOsWireResponse }
  | { role: "error"; ts: number; message: string }

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function safeStr(v: any, fallback = "") {
  if (v === null || v === undefined) return fallback
  const s = String(v).trim()
  return s || fallback
}

function safeNum(v: any, fallback = NaN) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// AJUSTA esto al ancho real de tu sidebar (tailwind arbitrary value)
const SIDEBAR_W = 260 // px
const SIDEBAR_LEFT_CLASS = `lg:left-[${SIDEBAR_W}px]`
const SIDEBAR_ML_CLASS = `lg:ml-[${SIDEBAR_W}px]`

/**
 * Humaniza respuesta en el CLIENTE (fallback robusto si el API no trae assistant_message).
 * OJO: si el API ya trae assistant_message, eso manda.
 */
function humanizeFromPayload(p: CommandOsWireResponse): string {
  const explicit = safeStr(p?.assistant_message, "")
  if (explicit) return explicit

  const intent = safeStr(p?.intent, "system.status")
  const ok = Boolean(p?.ok)
  const artifacts: any = p?.artifacts ?? null
  const data: any = artifacts?.data ?? artifacts?.result ?? artifacts ?? null

  if (!ok) {
    const err =
      safeStr(data?.error) ||
      safeStr(data?.message) ||
      safeStr(p?.explanation) ||
      "Falló la ejecución."
    return `No pude completar eso. Motivo: ${err}`
  }

  // --- lead.list.recents ---
  if (intent === "lead.list.recents") {
    const rows = Array.isArray(data?.leads) ? data.leads : Array.isArray(data) ? data : []
    if (!rows.length) return "No encontré leads recientes."

    const lines = rows.slice(0, 10).map((l: any, i: number) => {
      const name = safeStr(l?.lead_name || l?.name || l?.contact_name, "Sin nombre")
      const company = safeStr(l?.company || l?.company_name, "")
      const bucket = safeStr(l?.lead_brain_bucket || l?.bucket || l?.state || l?.status, "")
      const score = safeNum(l?.priority_score ?? l?.lead_brain_score ?? l?.score, NaN)
      const scoreTxt = Number.isFinite(score) ? ` • score ${score}` : ""
      const companyTxt = company ? ` — ${company}` : ""
      const bucketTxt = bucket ? ` • ${bucket}` : ""
      const id = safeStr(l?.lead_id || l?.id, "")
      const idTxt = id ? ` • id ${id}` : ""
      return `${i + 1}) ${name}${companyTxt}${bucketTxt}${scoreTxt}${idTxt}`
    })

    return `Leads recientes:\n${lines.join("\n")}\n\nDime: “inspecciona el #1” o “inspecciona el último lead”.`
  }

  // --- lead.inspect / lead.inspect.latest ---
  if (intent === "lead.inspect" || intent === "lead.inspect.latest") {
    const lead = data?.lead ?? data
    if (!lead) return "No encontré el lead."

    const name = safeStr(lead?.lead_name || lead?.name || lead?.contact_name, "Sin nombre")
    const company = safeStr(lead?.company || lead?.company_name, "—")
    const email = safeStr(lead?.email, "—")
    const phone = safeStr(lead?.phone, "—")
    const bucket = safeStr(lead?.lead_brain_bucket || lead?.bucket || lead?.state, "—")
    const recChan = safeStr(lead?.recommended_channel, "—")
    const recAct = safeStr(lead?.recommended_action, "—")
    const reason = safeStr(lead?.reason, "")
    const id = safeStr(lead?.lead_id || lead?.id, "")

    return [
      `Lead: ${name}`,
      `Empresa: ${company}`,
      `Email: ${email}`,
      `Tel: ${phone}`,
      `Bucket: ${bucket}`,
      `Recomendado: ${recChan} → ${recAct}`,
      reason ? `Por qué: ${reason}` : null,
      id ? `ID: ${id}` : null,
      ``,
      `Siguiente: “envíale el siguiente touch” o “enróllalo en campaña X”.`,
    ]
      .filter(Boolean)
      .join("\n")
  }

  // --- system.status ---
  if (intent === "system.status") {
    const checks = Array.isArray(data?.checks) ? data.checks : []
    if (!checks.length) return "Estado del sistema: OK."

    const lines = checks.slice(0, 12).map((c: any) => {
      const name = safeStr(c?.name, "check")
      const st = safeStr(c?.status, "unknown").toUpperCase()
      const msg = safeStr(c?.message, "")
      return `- ${st} ${name}${msg ? ` — ${msg}` : ""}`
    })
    return `Estado del sistema:\n${lines.join("\n")}`
  }

  // fallback OK
  return safeStr(p?.explanation, "") || `Hecho. (${intent})`
}

export default function CommandOsPage() {
  const [command, setCommand] = useState("")
  const [context, setContext] = useState('{"environment":"dev"}')
  const [contextOpen, setContextOpen] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)

  const [sending, setSending] = useState(false)
  const [chat, setChat] = useState<ChatMsg[]>([])

  // Drawer de artifacts
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTitle, setDrawerTitle] = useState<string>("Detalles")
  const [drawerArtifacts, setDrawerArtifacts] = useState<BrainResponse | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // --- AUTO account_id (sin que el usuario lo escriba) ---
  const [autoAccountId, setAutoAccountId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const v = localStorage.getItem("revenue_account_id")
      if (v && v.trim()) setAutoAccountId(v.trim())
    } catch {
      // ignore
    }
  }, [])

  // Si hay autoAccountId y el context JSON NO lo tiene, lo inyectamos en el textarea (one-time)
  useEffect(() => {
    if (!autoAccountId) return
    try {
      const obj = context ? JSON.parse(context) : {}
      if (!obj?.account_id) {
        const next = { ...obj, account_id: autoAccountId }
        setContext(JSON.stringify(next, null, 2))
      }
    } catch {
      // si el usuario lo rompió, no tocamos nada aquí
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAccountId])

  const lastAssistant = useMemo(() => {
    for (let i = chat.length - 1; i >= 0; i--) {
      const m = chat[i]
      if (m.role === "assistant") return m
    }
    return null
  }, [chat])

  function openArtifactsFrom(payload: CommandOsWireResponse) {
    const artifacts = payload?.artifacts ?? null
    setDrawerArtifacts(artifacts)
    setDrawerTitle(
      `Artifacts · ${payload.intent} · ${Math.round((payload.confidence ?? 0) * 100)}%`,
    )
    setDrawerOpen(true)
  }

  async function handleSend(text?: string) {
    const raw = (text ?? command).trim()
    if (!raw || sending) return

    setContextError(null)

    let parsedContext: any = {}
    try {
      parsedContext = context ? JSON.parse(context) : {}
    } catch {
      setContextError("Context no es JSON válido")
      setContextOpen(true)
      return
    }

    // Auto-inject account_id (si existe) para que el chat “sepa” en qué cuenta estás
    if (!parsedContext?.account_id && autoAccountId) {
      parsedContext = { ...parsedContext, account_id: autoAccountId }
    }

    const ts = Date.now()
    setChat((prev) => [...prev, { role: "user", ts, text: raw }])
    setSending(true)

    try {
      const res = await fetch("/api/command-os", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: raw, context: parsedContext }),
      })

      const json = (await res.json()) as CommandOsWireResponse

      setChat((prev) => [...prev, { role: "assistant", ts: Date.now(), payload: json }])

      // Si el usuario escribió "detalles"/"debug", abre drawer
      const low = raw.toLowerCase()
      if (low.includes("detalles") || low.includes("artifacts") || low.includes("debug")) {
        if (json?.artifacts) openArtifactsFrom(json)
      }
    } catch (err: any) {
      setChat((prev) => [
        ...prev,
        { role: "error", ts: Date.now(), message: err?.message ?? "Error desconocido" },
      ])
    } finally {
      setSending(false)
      setCommand("")
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [chat.length])

  function Chip({ label, onClick }: { label: string; onClick: () => void }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="px-2 py-1 rounded-full border border-slate-200/60 bg-white hover:bg-slate-50 text-[11px] text-slate-700 transition-colors"
      >
        {label}
      </button>
    )
  }

  function Bubble({
    children,
    role,
  }: {
    children: React.ReactNode
    role: "user" | "assistant" | "error"
  }) {
    const base = "max-w-[820px] w-full rounded-2xl px-4 py-3 border shadow-sm"
    const styles =
      role === "user"
        ? "ml-auto bg-slate-900 text-white border-slate-900"
        : role === "assistant"
          ? "mr-auto bg-white text-slate-900 border-slate-200"
          : "mr-auto bg-red-50 text-red-900 border-red-200"

    return <div className={`${base} ${styles}`}>{children}</div>
  }

  return (
    <div className={`min-h-screen bg-slate-50 text-slate-900 ${SIDEBAR_ML_CLASS}`}>
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <div>
              <div className="text-sm font-semibold tracking-wide">
                Revenue ASI · Command OS
              </div>
              <div className="text-[11px] text-slate-500">
                Chat → intents → ejecución. Limpio, rápido, sin ruido.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setContextOpen((v) => !v)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs"
            >
              Context
            </button>

            <button
              type="button"
              onClick={() => {
                if (lastAssistant?.payload?.artifacts) {
                  openArtifactsFrom(lastAssistant.payload)
                } else {
                  setDrawerArtifacts(null)
                  setDrawerTitle("Detalles")
                  setDrawerOpen(true)
                }
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs"
            >
              Detalles
            </button>
          </div>
        </div>

        {/* Context collapsable */}
        {contextOpen && (
          <div className="border-t border-slate-200 bg-white">
            <div className="mx-auto max-w-5xl px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-slate-700">Context (JSON)</div>
                {contextError ? (
                  <div className="text-[11px] text-red-600">{contextError}</div>
                ) : (
                  <div className="text-[11px] text-slate-500">
                    {autoAccountId ? (
                      <>
                        account_id auto: <span className="font-mono">{autoAccountId}</span>
                      </>
                    ) : (
                      <>
                        Tip: mete <span className="font-mono">account_id</span> (o setéalo en
                        localStorage como{" "}
                        <span className="font-mono">revenue_account_id</span>)
                      </>
                    )}
                  </div>
                )}
              </div>

              <textarea
                value={context}
                onChange={(e) => {
                  setContext(e.target.value)
                  setContextError(null)
                }}
                className={`w-full h-24 rounded-xl border bg-white px-3 py-2 font-mono text-[11px] focus:outline-none focus:ring-2 ${
                  contextError
                    ? "border-red-300 focus:ring-red-200"
                    : "border-slate-200 focus:ring-emerald-100"
                }`}
              />
            </div>
          </div>
        )}
      </header>

      {/* Chat body */}
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-28">
        {/* Quick actions */}
        <div className="mb-4 flex flex-wrap gap-2">
          <Chip label="Status" onClick={() => handleSend("dame el status del sistema")} />
          <Chip label="Leads recientes" onClick={() => handleSend("lista los últimos 10 leads")} />
          <Chip
            label="Inspecciona último lead"
            onClick={() => handleSend("inspecciona el último lead")}
          />
          <Chip label="Campaigns" onClick={() => handleSend("lista campañas recientes")} />
          <Chip label="Touch simulate" onClick={() => handleSend("simula 10 touches")} />
        </div>

        {chat.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold">Arranca con algo simple</div>
            <div className="mt-2 text-sm text-slate-600 space-y-1">
              <div>• “dame el status del sistema”</div>
              <div>• “lista los últimos 10 leads”</div>
              <div>• “inspecciona el lead con email ...”</div>
              <div>• “enrola el lead con email ... en campaña ... y confirma”</div>
            </div>
          </div>
        ) : (
          <div ref={scrollRef} className="space-y-3">
            {chat.map((m, idx) => {
              if (m.role === "user") {
                return (
                  <div key={idx} className="flex flex-col gap-1">
                    <div className="text-[10px] text-slate-400 text-right">
                      Tú · {formatTime(m.ts)}
                    </div>
                    <Bubble role="user">
                      <div className="whitespace-pre-wrap text-sm">{m.text}</div>
                    </Bubble>
                  </div>
                )
              }

              if (m.role === "error") {
                return (
                  <div key={idx} className="flex flex-col gap-1">
                    <div className="text-[10px] text-slate-400">Error · {formatTime(m.ts)}</div>
                    <Bubble role="error">
                      <div className="text-sm">{m.message}</div>
                    </Bubble>
                  </div>
                )
              }

              const p = m.payload
              const conf = clamp(Math.round((p.confidence ?? 0) * 100), 0, 100)

              // ✅ CAMBIO CLAVE: humaniza con fallback robusto
              const assistantText = humanizeFromPayload(p)

              // ✅ Solo mostramos explanation si hubo error o si no hay texto útil
              const showExplanation =
                !p.ok || !assistantText || assistantText.trim() === "" || assistantText.trim() === "Hecho."

              return (
                <div key={idx} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] text-slate-400">
                      Sistema · {formatTime(m.ts)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 font-mono">
                        {p.intent} · {conf}%
                      </span>
                      <button
                        type="button"
                        onClick={() => openArtifactsFrom(p)}
                        className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
                      >
                        Ver detalles
                      </button>
                    </div>
                  </div>

                  <Bubble role="assistant">
                    <div className="whitespace-pre-wrap text-sm">{assistantText}</div>
                    {showExplanation && p.explanation ? (
                      <div className="mt-2 text-[11px] text-slate-500">{p.explanation}</div>
                    ) : null}
                  </Bubble>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* Composer fixed */}
      <div className="fixed bottom-0 right-0 left-0 lg:left-72 border-t border-slate-200 bg-white/90 backdrop-blur z-20">
        <div className="mx-auto max-w-5xl px-4 py-3 flex gap-3 items-end">
          <div className="flex-1">
            <textarea
              ref={inputRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='Escribe un comando… (Enter para enviar, Shift+Enter para línea nueva)'
              className="w-full h-12 max-h-40 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
            {contextError ? (
              <div className="mt-1 text-[11px] text-red-600">{contextError}</div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => handleSend()}
            disabled={sending || !command.trim()}
            className="px-4 py-3 rounded-2xl bg-slate-900 text-white text-sm font-semibold disabled:opacity-40"
          >
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>

      {/* Drawer / overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-[720px] bg-white border-l border-slate-200 shadow-xl flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="text-sm font-semibold">{drawerTitle}</div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs"
              >
                Cerrar
              </button>
            </div>

            <div className="p-4 overflow-y-auto">
              {drawerArtifacts ? (
                <BrainResponseTranslator response={drawerArtifacts} />
              ) : (
                <div className="text-sm text-slate-600">
                  No hay artifacts disponibles todavía. Ejecuta un comando y luego abre “Detalles”.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
