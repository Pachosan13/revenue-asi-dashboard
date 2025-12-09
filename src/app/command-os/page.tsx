"use client"

import { useEffect, useRef, useState } from "react"
import BrainResponseTranslator, {
  BrainResponse,
} from "@/components/BrainResponseTranslator"

type CommandOsWireResponse = {
  ok: boolean
  intent: string
  explanation: string
  confidence: number
  version: string
  result: BrainResponse
}

type HistoryEntry =
  | {
      type: "user"
      ts: number
      text: string
    }
  | {
      type: "system"
      ts: number
      payload: CommandOsWireResponse
    }
  | {
      type: "error"
      ts: number
      message: string
    }

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export default function CommandOsPage() {
  const [command, setCommand] = useState("")
  const [context, setContext] = useState('{"environment":"dev"}')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [sending, setSending] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<BrainResponse | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)

  async function handleSend() {
    if (!command.trim() || sending) return
    setContextError(null)

    let parsedContext: any = {}
    try {
      parsedContext = context ? JSON.parse(context) : {}
    } catch (e: any) {
      setContextError("Context no es JSON válido")
      return
    }

    const ts = Date.now()

    setHistory((prev) => [...prev, { type: "user", ts, text: command.trim() }])

    setSending(true)
    try {
      const res = await fetch("/api/command-os", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: command.trim(),
          context: parsedContext,
        }),
      })

      const json = (await res.json()) as CommandOsWireResponse

      setHistory((prev) => [
        ...prev,
        { type: "system", ts: Date.now(), payload: json },
      ])

      // Guardamos solo la parte que nos importa para el traductor humano
      if (json?.result) {
        setLastResult(json.result)
      }
    } catch (err: any) {
      setHistory((prev) => [
        ...prev,
        {
          type: "error",
          ts: Date.now(),
          message: err?.message ?? "Error desconocido",
        },
      ])
    } finally {
      setSending(false)
      setCommand("")
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [history])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-900 text-slate-50 relative overflow-hidden">
      {/* HUD overlays */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_#22c55e20,_transparent_55%),radial-gradient(circle_at_bottom,_#0ea5e920,_transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(transparent_0,transparent_96%,#22c55e15_100%),linear-gradient(90deg,transparent_0,transparent_96%,#22c55e15_100%)] bg-[size:100%_32px,32px_100%] opacity-30 mix-blend-screen" />
      </div>

      <div className="relative z-10 flex flex-col min-h-screen">
        {/* TOP BAR */}
        <header className="border-b border-emerald-700/50 bg-black/60 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <h1 className="text-sm font-semibold tracking-[0.22em] text-emerald-300 uppercase">
                  Revenue ASI — Command OS
                </h1>
              </div>
              <p className="text-xs text-emerald-500 mt-1">
                Brain Interface · Hablas en humano, el sistema traduce a acciones.
              </p>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-emerald-400/80">
              <div className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>ENGINE: ONLINE</span>
              </div>
              <span className="px-2 py-0.5 border border-emerald-700/70 rounded-full bg-black/60">
                MODE: DEV
              </span>
            </div>
          </div>
        </header>

        {/* MAIN GRID */}
        <main className="flex-1 mx-auto max-w-6xl w-full px-5 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)] gap-6">
          {/* LEFT: COMMAND PANEL */}
          <section className="space-y-4">
            <div className="rounded-2xl border border-emerald-800/60 bg-black/70 shadow-[0_0_40px_rgba(16,185,129,0.15)] p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-xs font-semibold tracking-[0.2em] text-emerald-300 uppercase">
                    Command input
                  </h2>
                  <p className="text-[11px] text-emerald-500 mt-1">
                    Habla como humano. ⌘+Enter / Ctrl+Enter para ejecutar.
                  </p>
                </div>
                <div className="text-[10px] text-emerald-400/80 text-right">
                  <p>Salida: respuesta humana</p>
                  <p>Brains: intents + router seguro</p>
                </div>
              </div>

              <textarea
                className="w-full rounded-xl border border-emerald-800/70 bg-gradient-to-br from-black via-slate-950 to-emerald-950/30 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/70 focus:border-emerald-400/80 h-28 placeholder:text-emerald-700"
                placeholder='Ej: "inspecciona el lead con email pacho@test.com"'
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={handleKeyDown}
              />

              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-[0.18em] text-emerald-300 uppercase">
                    Context (JSON)
                  </span>
                  {contextError && (
                    <span className="text-[10px] text-red-400 font-mono">
                      {contextError}
                    </span>
                  )}
                </div>
                <textarea
                  className={`w-full rounded-xl border bg-black/80 px-3 py-2 text-[11px] font-mono h-20 focus:outline-none focus:ring-2 ${
                    contextError
                      ? "border-red-500/70 focus:ring-red-500/70 text-red-300"
                      : "border-emerald-800/70 focus:ring-emerald-500/70 text-emerald-300"
                  }`}
                  value={context}
                  onChange={(e) => {
                    setContext(e.target.value)
                    setContextError(null)
                  }}
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-[11px] text-emerald-500/90">
                  <p className="uppercase tracking-[0.16em] text-emerald-400/90">
                    Quick macros
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setCommand("dame el status del sistema")}
                      className="px-2 py-0.5 rounded-full border border-emerald-800/70 text-[10px] text-emerald-300 bg-black/60 hover:bg-emerald-900/40 transition-colors"
                    >
                      system.status
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCommand(
                          "inspecciona el lead con email pacho@test.com",
                        )
                      }
                      className="px-2 py-0.5 rounded-full border border-emerald-800/70 text-[10px] text-emerald-300 bg-black/60 hover:bg-emerald-900/40 transition-colors"
                    >
                      lead.inspect (email)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCommand(
                          "enrola el lead con email pacho@test.com en la campaña de prueba de dentistas y confirma",
                        )
                      }
                      className="px-2 py-0.5 rounded-full border border-emerald-800/70 text-[10px] text-emerald-300 bg-black/60 hover:bg-emerald-900/40 transition-colors"
                    >
                      lead.enroll
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !command.trim()}
                  className="shrink-0 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-emerald-500 text-black text-xs font-semibold tracking-wide shadow-[0_0_25px_rgba(16,185,129,0.6)] hover:bg-emerald-400 disabled:opacity-40 disabled:shadow-none transition-all"
                >
                  {sending ? "Ejecutando…" : "Ejecutar comando"}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-800/40 bg-black/60 px-4 py-3 text-[11px] text-emerald-400 space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="uppercase tracking-[0.18em] text-emerald-300">
                  Intents soportados
                </span>
              </div>
              <p>
                <span className="font-mono text-emerald-300">system.status</span>,{" "}
                <span className="font-mono text-emerald-300">lead.inspect</span>,{" "}
                <span className="font-mono text-emerald-300">lead.enroll</span>,{" "}
                <span className="font-mono text-emerald-300">lead.update</span>,{" "}
                <span className="font-mono text-emerald-300">
                  lead.list.recents
                </span>
              </p>
              <p className="text-emerald-500/80">
                Tú hablas en humano. El brain resuelve emails, phones,
                nombres de campaña y IDs internos.
              </p>
            </div>
          </section>

          {/* RIGHT: HUMAN VIEW + HISTORY */}
          <section className="flex flex-col gap-4">
            {/* HUMAN TRANSLATION */}
            <div className="rounded-2xl border border-emerald-800/60 bg-black/80 shadow-[0_0_40px_rgba(16,185,129,0.12)] p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-semibold tracking-[0.18em] text-emerald-300 uppercase">
                    Respuesta del sistema
                  </p>
                  <p className="text-[11px] text-emerald-500 mt-1">
                    Vista explicada en lenguaje humano. Sin JSON, sin ruido.
                  </p>
                </div>
              </div>

              {lastResult ? (
                <BrainResponseTranslator response={lastResult} />
              ) : (
                <p className="text-emerald-500 text-sm">
                  Aún no hay actividad. Envía tu primer comando al brain.
                </p>
              )}
            </div>

            {/* LIGHT HISTORY (HUMAN STYLE) */}
            <div className="rounded-2xl border border-emerald-800/40 bg-black/70 shadow-[0_0_30px_rgba(16,185,129,0.1)] flex-1 flex flex-col">
              <div className="border-b border-emerald-800/60 px-4 py-3">
                <p className="text-xs font-semibold tracking-[0.18em] text-emerald-300 uppercase">
                  Historial reciente
                </p>
                <p className="text-[11px] text-emerald-500 mt-1">
                  Conversación resumida entre tú y el brain.
                </p>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-4 py-4 space-y-3 text-xs"
              >
                {history.length === 0 && (
                  <div className="h-full flex items-center justify-center text-emerald-600/80 italic">
                    Sin tráfico aún.
                  </div>
                )}

                {history.map((entry, idx) => {
                  if (entry.type === "user") {
                    return (
                      <div
                        key={idx}
                        className="border border-emerald-800/70 rounded-xl bg-emerald-950/40 px-3 py-2"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                            Tú
                          </span>
                          <span className="text-[10px] text-emerald-500/80 font-mono">
                            {formatTime(entry.ts)}
                          </span>
                        </div>
                        <p className="text-emerald-100 text-[11px]">
                          {entry.text}
                        </p>
                      </div>
                    )
                  }

                  if (entry.type === "error") {
                    return (
                      <div
                        key={idx}
                        className="border border-red-700/70 rounded-xl bg-red-950/40 px-3 py-2"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-red-300">
                            Error del sistema
                          </span>
                          <span className="text-[10px] text-red-400/80 font-mono">
                            {formatTime(entry.ts)}
                          </span>
                        </div>
                        <p className="text-red-200 text-[11px]">
                          {entry.message}
                        </p>
                      </div>
                    )
                  }

                  const payload = entry.payload
                  const conf = Math.round(payload.confidence * 100)

                  return (
                    <div
                      key={idx}
                      className="border border-emerald-800/80 rounded-xl bg-gradient-to-br from-black via-slate-950 to-emerald-950/40 px-3 py-2 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                          Sistema
                        </span>
                        <span className="text-[10px] text-emerald-500/80 font-mono">
                          {formatTime(entry.ts)}
                        </span>
                      </div>
                      <p className="text-[11px] text-emerald-100">
                        Intento interpretado:{" "}
                        <span className="font-mono text-emerald-300">
                          {payload.intent}
                        </span>{" "}
                        ({conf}% confianza).
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
