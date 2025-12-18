// src/app/login/page.tsx
"use client"

import React, { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export default function LoginPage() {
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
      setError(j?.error || "Login failed")
      return
    }

    // cookies ya están seteadas → ahora sí SSR ve sesión
    router.replace(next)
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6"
      >
        <h1 className="text-xl font-semibold">Revenue ASI · Login</h1>

        <div className="mt-4 space-y-3">
          <input
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 outline-none"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <input
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 outline-none"
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}

        <button
          disabled={loading}
          className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-2 font-medium disabled:opacity-60"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <p className="mt-3 text-xs text-white/50">
          Si no hay cookies de Supabase, Command OS siempre va a decir “Auth session missing”.
        </p>
      </form>
    </div>
  )
}
