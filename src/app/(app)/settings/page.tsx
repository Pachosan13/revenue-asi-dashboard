"use client"

import React, { useEffect, useMemo, useState } from "react"
import { CheckCircle, ToggleLeft, ToggleRight } from "lucide-react"
import { supabaseBrowser } from "@/lib/supabase"
import { Button, Card, CardContent, CardHeader, Input, StatCard } from "@/components/ui-custom"

type OrgSettings = {
  id?: string
  autopause_on_errors: boolean
  notify_on_anomalies: boolean
  sync_crm_webhooks: boolean
  fallback_email: string
  webhook_url: string
  business_name?: string
  contact_email?: string
  contact_phone?: string
  contact_whatsapp?: string
  vertical?: string
  leadgen_routing?: {
    dealer_address: string
    radius_miles: number
    city_fallback: string
    active: boolean
  } | null
  updated_at?: string | null
}

const defaultSettings: OrgSettings = {
  autopause_on_errors: false,
  notify_on_anomalies: true,
  sync_crm_webhooks: false,
  fallback_email: "alerts@company.com",
  webhook_url: "https://hooks.slack.com/...",
  business_name: "",
  contact_email: "",
  contact_phone: "",
  contact_whatsapp: "",
  vertical: "car_dealer",
  leadgen_routing: {
    dealer_address: "",
    radius_miles: 10,
    city_fallback: "",
    active: false,
  },
}

export default function SettingsPage() {
  const supabase = useMemo(() => {
    const hasEnv = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    return hasEnv ? supabaseBrowser() : null
  }, [])

  const envConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const [settings, setSettings] = useState<OrgSettings>(defaultSettings)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [errors, setErrors] = useState<{
    business_name?: string
    contact_email?: string
    dealer_address?: string
    radius_miles?: string
    city?: string
  }>({})

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let alive = true
    async function loadSettings() {
      const { data, error } = await client.from("org_settings").select("*").limit(1).maybeSingle()
      if (!alive) return

      if (error && error.code !== "PGRST116") {
        console.warn("Falling back to defaults", error)
        setSettings(defaultSettings)
      } else if (data) {
        setSettings({
          id: data.id,
          autopause_on_errors: Boolean(data.autopause_on_errors),
          notify_on_anomalies: Boolean(data.notify_on_anomalies),
          sync_crm_webhooks: Boolean(data.sync_crm_webhooks),
          fallback_email: data.fallback_email ?? defaultSettings.fallback_email,
          webhook_url: data.webhook_url ?? defaultSettings.webhook_url,
          business_name: data.business_name ?? defaultSettings.business_name,
          contact_email: data.contact_email ?? defaultSettings.contact_email,
          contact_phone: data.contact_phone ?? defaultSettings.contact_phone,
          contact_whatsapp: data.contact_whatsapp ?? defaultSettings.contact_whatsapp,
          vertical: data.vertical ?? defaultSettings.vertical,
          leadgen_routing: data.leadgen_routing ?? defaultSettings.leadgen_routing,
          updated_at: data.updated_at,
        })
      } else {
        setSettings(defaultSettings)
      }
      setLoading(false)
    }

    void loadSettings()
    return () => {
      alive = false
    }
  }, [supabase])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(id)
  }, [toast])

  const handleSave = async () => {
    if (!supabase) {
      setToast({ type: "error", message: "Supabase env missing" })
      return
    }

    const nextErrors: typeof errors = {}

    const businessName = String(settings.business_name ?? "").trim()
    if (!businessName) nextErrors.business_name = "Business name is required."

    const contactEmail = String(settings.contact_email ?? "").trim()
    const emailOk = Boolean(contactEmail) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
    if (!emailOk) nextErrors.contact_email = "Valid email is required."

    const routing = settings.leadgen_routing ?? null
    if (routing) {
      const radius = Number(routing.radius_miles)
      if (!Number.isFinite(radius) || radius < 1 || radius > 50) {
        nextErrors.radius_miles = "Radius must be 1–50 miles."
      }
      if (routing.active && !String(routing.dealer_address ?? "").trim()) {
        nextErrors.dealer_address = "Address is required when routing is active."
      }
      if (routing.active && !String(routing.city_fallback ?? "").trim()) {
        nextErrors.city = "City is required when routing is active."
      }
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setToast({ type: "error", message: "Please fix the highlighted fields." })
      return
    }

    setSaving(true)
    const payload = {
      id: settings.id || crypto.randomUUID(),
      autopause_on_errors: settings.autopause_on_errors,
      notify_on_anomalies: settings.notify_on_anomalies,
      sync_crm_webhooks: settings.sync_crm_webhooks,
      fallback_email: settings.fallback_email,
      webhook_url: settings.webhook_url,
      business_name: businessName,
      contact_email: contactEmail,
      contact_phone: String(settings.contact_phone ?? "").trim() || null,
      contact_whatsapp: String(settings.contact_whatsapp ?? "").trim() || null,
      vertical: String(settings.vertical ?? "car_dealer").trim() || "car_dealer",
      leadgen_routing: routing,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase.from("org_settings").upsert(payload).select().maybeSingle()
    if (error) {
      console.error("Failed to save settings", error)
      setToast({ type: "error", message: "Save failed" })
    } else if (data) {
      setSettings({
        id: data.id,
        autopause_on_errors: Boolean(data.autopause_on_errors),
        notify_on_anomalies: Boolean(data.notify_on_anomalies),
        sync_crm_webhooks: Boolean(data.sync_crm_webhooks),
        fallback_email: data.fallback_email ?? "",
        webhook_url: data.webhook_url ?? "",
        business_name: data.business_name ?? "",
        contact_email: data.contact_email ?? "",
        contact_phone: data.contact_phone ?? "",
        contact_whatsapp: data.contact_whatsapp ?? "",
        vertical: data.vertical ?? "car_dealer",
        leadgen_routing: data.leadgen_routing ?? defaultSettings.leadgen_routing,
        updated_at: data.updated_at,
      })
      setToast({ type: "success", message: "Onboarding complete" })
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">Setup</p>
          <h1 className="text-3xl font-semibold text-white">Onboarding</h1>
          <p className="text-sm text-white/60">Identity + contact + routing. Ready in under 3 minutes.</p>
        </div>
        <Button variant="primary" size="sm" className="gap-2" onClick={handleSave} disabled={saving}>
          <CheckCircle size={16} />
          {saving ? "Saving..." : "Save & Continue"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Supabase"
          value={envConfigured ? "Env configured" : "Missing env"}
          helper="NEXT_PUBLIC_SUPABASE_*"
          delta={envConfigured ? "Ready" : "Action"}
        />
        <StatCard
          label="Vertical"
          value="car_dealer"
          helper="Stored (hidden input)"
          delta="Default"
        />
        <StatCard
          label="Routing"
          value={settings.leadgen_routing?.active ? "Active" : "Inactive"}
          helper="LeadGen Routing"
          delta={settings.leadgen_routing?.active ? "Enabled" : "Disabled"}
        />
      </div>

      <Card>
        <CardHeader
          title="Step 1: Business Info"
          description={
            loading
              ? "Loading config..."
              : supabase
                ? "Values read from Supabase org_settings"
                : "Env-only mode. Update NEXT_PUBLIC_SUPABASE_* to connect."
          }
        />
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Business name</p>
            <Input
              placeholder="Example Auto Mall"
              value={String(settings.business_name ?? "")}
              onChange={(e) => {
                setSettings((prev) => ({ ...prev, business_name: e.target.value }))
                setErrors((prev) => ({ ...prev, business_name: undefined }))
              }}
              disabled={!supabase}
            />
            {errors.business_name ? <p className="text-xs text-rose-300">{errors.business_name}</p> : null}
          </div>

          <Card>
            <CardHeader title="Step 2: Contact Info" description="Primary point of contact for notifications and support." />
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-white/50">Contact email</p>
                  <Input
                    placeholder="owner@dealer.com"
                    value={String(settings.contact_email ?? "")}
                    onChange={(e) => {
                      setSettings((prev) => ({ ...prev, contact_email: e.target.value }))
                      setErrors((prev) => ({ ...prev, contact_email: undefined }))
                    }}
                    disabled={!supabase}
                  />
                  {errors.contact_email ? <p className="text-xs text-rose-300">{errors.contact_email}</p> : null}
                </div>

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-white/50">Contact phone (optional)</p>
                  <Input
                    placeholder="+1 305 555 0101"
                    value={String(settings.contact_phone ?? "")}
                    onChange={(e) => setSettings((prev) => ({ ...prev, contact_phone: e.target.value }))}
                    disabled={!supabase}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-white/50">Contact WhatsApp (optional)</p>
                  <Input
                    placeholder="+1 305 555 0101"
                    value={String(settings.contact_whatsapp ?? "")}
                    onChange={(e) => setSettings((prev) => ({ ...prev, contact_whatsapp: e.target.value }))}
                    disabled={!supabase}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Step 3: Location & Radius" description="Uses existing LeadGen Routing config (no auto-start)." />
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-white/50">Address</p>
                  <Input
                    placeholder="123 Main St, Miami, FL"
                    value={settings.leadgen_routing?.dealer_address ?? ""}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        leadgen_routing: {
                          dealer_address: e.target.value,
                          radius_miles: Number(prev.leadgen_routing?.radius_miles ?? 10),
                          city_fallback: String(prev.leadgen_routing?.city_fallback ?? ""),
                          active: Boolean(prev.leadgen_routing?.active ?? false),
                        },
                      }))
                    }
                    disabled={!supabase}
                  />
                  {errors.dealer_address ? <p className="text-xs text-rose-300">{errors.dealer_address}</p> : <p className="text-xs text-white/50">Required when Active is enabled.</p>}
                </div>

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-white/50">Radius (miles)</p>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={String(settings.leadgen_routing?.radius_miles ?? 10)}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setSettings((prev) => ({
                        ...prev,
                        leadgen_routing: {
                          dealer_address: String(prev.leadgen_routing?.dealer_address ?? ""),
                          radius_miles: Number.isFinite(n) ? n : 10,
                          city_fallback: String(prev.leadgen_routing?.city_fallback ?? ""),
                          active: Boolean(prev.leadgen_routing?.active ?? false),
                        },
                      }))
                      setErrors((prev) => ({ ...prev, radius_miles: undefined }))
                    }}
                    disabled={!supabase}
                  />
                  {errors.radius_miles ? <p className="text-xs text-rose-300">{errors.radius_miles}</p> : <p className="text-xs text-white/50">1–50 miles.</p>}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-white/50">City</p>
                  <Input
                    placeholder="miami"
                    value={settings.leadgen_routing?.city_fallback ?? ""}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        leadgen_routing: {
                          dealer_address: String(prev.leadgen_routing?.dealer_address ?? ""),
                          radius_miles: Number(prev.leadgen_routing?.radius_miles ?? 10),
                          city_fallback: e.target.value,
                          active: Boolean(prev.leadgen_routing?.active ?? false),
                        },
                      }))
                    }
                    disabled={!supabase}
                  />
                  {errors.city ? <p className="text-xs text-rose-300">{errors.city}</p> : <p className="text-xs text-white/50">Used when a command omits a city.</p>}
                </div>

                <button
                  type="button"
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left"
                  onClick={() =>
                    setSettings((prev) => ({
                      ...prev,
                      leadgen_routing: {
                        dealer_address: String(prev.leadgen_routing?.dealer_address ?? ""),
                        radius_miles: Number(prev.leadgen_routing?.radius_miles ?? 10),
                        city_fallback: String(prev.leadgen_routing?.city_fallback ?? ""),
                        active: !Boolean(prev.leadgen_routing?.active ?? false),
                      },
                    }))
                  }
                  disabled={!supabase}
                >
                  <div>
                    <p className="font-semibold text-white">Active</p>
                    <p className="text-xs text-white/50">
                      {settings.leadgen_routing?.active ? "Enabled" : "Disabled"}
                    </p>
                  </div>
                  {settings.leadgen_routing?.active ? (
                    <ToggleRight className="text-emerald-300" />
                  ) : (
                    <ToggleLeft className="text-white/40" />
                  )}
                </button>
              </div>
            </CardContent>
          </Card>

          {settings.updated_at ? (
            <p className="text-xs text-white/50">Last updated {new Date(settings.updated_at).toLocaleString()}</p>
          ) : null}

          {toast ? (
            <div
              className={`rounded-xl px-3 py-2 text-sm ${
                toast.type === "success" ? "bg-emerald-500/20 text-emerald-100" : "bg-amber-500/20 text-amber-100"
              }`}
            >
              {toast.message}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
