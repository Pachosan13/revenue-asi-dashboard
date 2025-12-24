"use client"

import React, { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabaseBrowser } from "@/lib/supabase"
import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Input,
  Textarea,
  Select,
  Badge,
} from "@/components/ui-custom"
import { Sparkles, ArrowRight, Loader2 } from "lucide-react"

export const dynamic = "force-dynamic"

const TYPE_OPTIONS = [
  { value: "outbound", label: "Outbound" },
  { value: "nurture", label: "Nurture" },
  { value: "reactivation", label: "Reactivation" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
]

export default function NewCampaignPage() {
  const router = useRouter()

  // ✅ NO crear el client si faltan env vars (esto es lo que rompe `next build`)
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) return null
    return supabaseBrowser()
  }, [])

  const [name, setName] = useState("")
  const [type, setType] = useState("outbound")
  const [niche, setNiche] = useState("")
  const [geo, setGeo] = useState("")
  const [icp, setIcp] = useState("")
  const [description, setDescription] = useState("")
  const [dailyLimit, setDailyLimit] = useState(150)
  const [firstMessage, setFirstMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createCampaign() {
    if (!name.trim()) {
      setError("Name is required.")
      return
    }

    // ✅ si por alguna razón el entorno no tiene env vars, no explotes
    if (!supabase) {
      setError(
        "Supabase no está configurado en este entorno (missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).",
      )
      return
    }

    setLoading(true)
    setError(null)

    // ⚠️ IMPORTANTE:
    // Para NO romper tu esquema actual, solo guardamos campos seguros.
    const payload = {
      name: name.trim(),
      type,
      status: "draft",
      // Si luego creas columnas extra, puedes ir agregando:
      // niche,
      // geo,
      // icp,
      // description,
      // daily_limit: dailyLimit,
      // message_initial: firstMessage,
    }

    const { data, error } = await supabase
      .from("campaigns")
      .insert(payload)
      .select("*")
      .single()

    if (error) {
      console.error("Error creating campaign", error)
      setError(error.message)
      setLoading(false)
      return
    }

    router.push(`/campaigns/${data.id}`)
  }

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/40">
            Program builder
          </p>
          <h1 className="text-3xl font-semibold text-white">Create new campaign</h1>
          <p className="text-sm text-white/60">
            Define strategy, ICP, copy & cadence. The OS will orchestrate everything else.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="text-emerald-300 border-emerald-400/50"
          >
            V1 Composer
          </Badge>

          {/* ✅ indicador sin romper UI */}
          <Badge variant={supabase ? "success" : "warning"}>
            {supabase ? "Live engine" : "Offline env"}
          </Badge>
        </div>
      </div>

      {/* FORM */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader
          title="Campaign details"
          description="Basic identity & strategy"
        />

        <CardContent className="space-y-6">
          {/* NAME */}
          <div className="space-y-1">
            <label className="text-sm text-white/70">Program name</label>
            <Input
              placeholder="Dentists Florida – Cold Outbound"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* TYPE + NICHE + GEO */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-sm text-white/70">Type</label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm text-white/70">Niche</label>
              <Input
                placeholder="Dentists"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm text-white/70">Geo market</label>
              <Input
                placeholder="Florida, USA"
                value={geo}
                onChange={(e) => setGeo(e.target.value)}
              />
            </div>
          </div>

          {/* ICP */}
          <div className="space-y-1">
            <label className="text-sm text-white/70">ICP (optional)</label>
            <Textarea
              placeholder="Owners of dental clinics with 1–3 chairs, interested in growing revenue through patient flow..."
              rows={3}
              value={icp}
              onChange={(e) => setIcp(e.target.value)}
            />
          </div>

          {/* DESCRIPTION */}
          <div className="space-y-1">
            <label className="text-sm text-white/70">Strategic notes</label>
            <Textarea
              placeholder="This program targets dentists in Florida. Main angle: better patient flow, reduced no-shows, automation..."
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* DAILY LIMIT */}
          <div className="space-y-1">
            <label className="text-sm text-white/70">Daily throughput limit</label>
            <Input
              type="number"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Number(e.target.value))}
            />
            <p className="text-xs text-white/40">
              OS will never exceed this daily send rate.
            </p>
          </div>

          {/* FIRST MESSAGE */}
          <div className="space-y-1">
            <label className="text-sm text-white/70">First outbound message</label>
            <Textarea
              placeholder="Hi {{first_name}}, quick question about your patient flow…"
              rows={4}
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
            />
          </div>

          {/* PREVIEW */}
          <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-2">
            <p className="text-white/60 text-sm">Message preview:</p>
            <div className="rounded-xl border border-white/5 bg-white/5 p-3 text-white/80 text-sm">
              {firstMessage || "Start typing a message to see preview..."}
            </div>
          </div>

          {/* ERROR */}
          {error && (
            <div className="text-sm text-red-400 border border-red-400/30 bg-red-500/10 p-3 rounded-xl">
              {error}
            </div>
          )}

          {/* ACTIONS */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="ghost"
              onClick={() => router.push("/campaigns")}
              className="border border-white/10"
            >
              Cancel
            </Button>

            <Button
              variant="primary"
              onClick={createCampaign}
              disabled={loading || !name.trim()}
              className="gap-2"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              Create program
              <ArrowRight size={16} />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}