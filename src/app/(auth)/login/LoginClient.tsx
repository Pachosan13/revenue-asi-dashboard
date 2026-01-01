"use client"

import React, { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export default function LoginClient() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get("next") || "/command-os"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })

    const j = await r.json().catch(() => ({}))

    if (!r.ok || !j?.ok) {
      setLoading(false)
      setError(j?.error || "Credenciales inválidas")
      return
    }

    router.replace(next)
  }

  return (
    <div className="min-h-screen w-full bg-black text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Revenue ASI</h1>
          <p className="mt-2 text-sm text-white/60">Accede a tu motor de ingresos</p>
        </div>

        {/* Card */}
        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6 shadow-xl"
        >
          <div className="space-y-4">
            <input
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-emerald-500"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />

            <input
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none focus:border-emerald-500"
              placeholder="Contraseña"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

          <button
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium hover:bg-emerald-500 disabled:opacity-60"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>

          {/* Links */}
          <div className="mt-6 flex items-center justify-between text-xs text-white/60">
            <button type="button" onClick={() => router.push("/signup")} className="hover:text-white">
              Crear cuenta
            </button>

            <button type="button" onClick={() => router.push("/reset-password")} className="hover:text-white">
              Olvidé mi contraseña
            </button>
          </div>
        </form>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-white/40">
          Seguridad, trazabilidad y control total de tu outreach
        </p>
      </div>
    </div>
  )
}


