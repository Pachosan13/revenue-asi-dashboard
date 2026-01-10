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

  const toggleSetting = (key: keyof Pick<OrgSettings, "autopause_on_errors" | "notify_on_anomalies" | "sync_crm_webhooks">) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSave = async () => {
    if (!supabase) {
      setToast({ type: "error", message: "Supabase env missing" })
      return
    }

    const routing = settings.leadgen_routing ?? null
    if (routing) {
      const radius = Number(routing.radius_miles)
      if (!Number.isFinite(radius) || radius < 1 || radius > 50) {
        setToast({ type: "error", message: "LeadGen Routing: radius must be 1–50 miles" })
        return
      }
      if (routing.active && !String(routing.dealer_address ?? "").trim()) {
        setToast({ type: "error", message: "LeadGen Routing: dealer address required when active" })
        return
      }
    }

    setSaving(true)
    const payload = {
      id: settings.id || crypto.randomUUID(),
      autopause_on_errors: settings.autopause_on_errors,
      notify_on_anomalies: settings.notify_on_anomalies,
      sync_crm_webhooks: settings.sync_crm_webhooks,
      fallback_email: settings.fallback_email,
      webhook_url: settings.webhook_url,
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
        leadgen_routing: data.leadgen_routing ?? defaultSettings.leadgen_routing,
        updated_at: data.updated_at,
      })
      setToast({ type: "success", message: "Settings saved" })
    }
    setSaving(false)
  }

  const toggles = [
    { key: "autopause_on_errors" as const, label: "Auto-pause on errors" },
    { key: "notify_on_anomalies" as const, label: "Notify ops on anomalies" },
    { key: "sync_crm_webhooks" as const, label: "Sync CRM webhooks" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">Org</p>
          <h1 className="text-3xl font-semibold text-white">Settings</h1>
          <p className="text-sm text-white/60">Configure rollout, safety, and routing preferences.</p>
        </div>
        <Button variant="primary" size="sm" className="gap-2" onClick={handleSave} disabled={saving}>
          <CheckCircle size={16} />
          {saving ? "Saving..." : "Save changes"}
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
          label="Safety"
          value={settings.autopause_on_errors ? "Auto-pause on" : "Guardrail pending"}
          helper="Stops campaigns after anomalies"
          delta="Guardrails"
        />
        <StatCard
          label="Notifications"
          value={settings.notify_on_anomalies ? "Ops notified" : "Muted"}
          helper="Slack/Email routing"
          delta="Live"
        />
      </div>

      <Card>
        <CardHeader
          title="Controls"
          description={
            loading
              ? "Loading config..."
              : supabase
                ? "Values read from Supabase org_settings"
                : "Env-only mode. Update NEXT_PUBLIC_SUPABASE_* to connect."
          }
        />
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {toggles.map((toggle) => {
              const enabled = settings[toggle.key]
              return (
                <button
                  key={toggle.key}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left"
                  onClick={() => toggleSetting(toggle.key)}
                  type="button"
                  disabled={!supabase}
                >
                  <div>
                    <p className="font-semibold text-white">{toggle.label}</p>
                    <p className="text-xs text-white/50">{enabled ? "Enabled" : "Disabled"}</p>
                  </div>
                  {enabled ? <ToggleRight className="text-emerald-300" /> : <ToggleLeft className="text-white/40" />}
                </button>
              )
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Fallback email</p>
              <Input
                placeholder="alerts@company.com"
                value={settings.fallback_email}
                onChange={(e) => setSettings((prev) => ({ ...prev, fallback_email: e.target.value }))}
                disabled={!supabase}
              />
              <p className="text-xs text-white/50">Used when routing alerts fails.</p>
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Webhook URL</p>
              <Input
                placeholder="https://hooks.slack.com/..."
                value={settings.webhook_url}
                onChange={(e) => setSettings((prev) => ({ ...prev, webhook_url: e.target.value }))}
                disabled={!supabase}
              />
              <p className="text-xs text-white/50">Delivery target for anomalies and pauses.</p>
            </div>
          </div>

          <Card>
            <CardHeader
              title="LeadGen Routing"
              description="Dealer routing settings for Craigslist LeadGen (stored in org_settings.leadgen_routing)."
            />
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-white/50">Dealer address</p>
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
                  <p className="text-xs text-white/50">Required when Active is enabled.</p>
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
                    }}
                    disabled={!supabase}
                  />
                  <p className="text-xs text-white/50">1–50 miles.</p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-white/50">City fallback</p>
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
                  <p className="text-xs text-white/50">Used when Command OS command omits a city.</p>
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
