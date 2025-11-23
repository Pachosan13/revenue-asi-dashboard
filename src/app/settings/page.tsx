"use client"

import React, { useEffect, useMemo, useState } from "react"
import { CheckCircle, ToggleLeft, ToggleRight } from "lucide-react"
import { supabaseBrowser } from "@/lib/supabase"
import { Button, Card, CardContent, CardHeader, Input, StatCard } from "@/components/ui-custom"

type SettingRow = {
  id: string
  key: string
  value: string
}

export default function SettingsPage() {
  const supabase = useMemo(() => {
    const hasEnv = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!hasEnv) return null
    return supabaseBrowser()
  }, [])

  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const envConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  useEffect(() => {
    let alive = true

    async function loadSettings() {
      if (!supabase) {
        setLoading(false)
        return
      }

      const { data, error } = await supabase.from("settings").select("id, key, value").limit(50)
      if (!alive) return

      if (error) {
        console.warn("Falling back to env-only settings", error)
        setSettings({})
      } else if (data) {
        const parsed: Record<string, string> = {}
        for (const row of data as SettingRow[]) {
          parsed[row.key] = row.value
        }
        setSettings(parsed)
      }
      setLoading(false)
    }

    loadSettings()
    return () => {
      alive = false
    }
  }, [supabase])

  const toggles = [
    { key: "auto_pause", label: "Auto-pause on errors" },
    { key: "notify_ops", label: "Notify ops on anomalies" },
    { key: "sync_crm", label: "Sync CRM webhooks" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">Org</p>
          <h1 className="text-3xl font-semibold text-white">Settings</h1>
          <p className="text-sm text-white/60">Configure rollout, safety, and routing preferences.</p>
        </div>
        <Button variant="primary" size="sm" className="gap-2">
          <CheckCircle size={16} />
          Save changes
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
          value={settings.auto_pause === "true" ? "Auto-pause on" : "Guardrail pending"}
          helper="Stops campaigns after anomalies"
          delta="Guardrails"
        />
        <StatCard
          label="Notifications"
          value={settings.notify_ops === "true" ? "Ops notified" : "Muted"}
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
                ? "Values read from Supabase settings"
                : "Env-only mode. Update NEXT_PUBLIC_SUPABASE_* to connect."
          }
        />
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {toggles.map((toggle) => {
              const enabled = settings[toggle.key] === "true"
              return (
                <div key={toggle.key} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <div>
                    <p className="font-semibold text-white">{toggle.label}</p>
                    <p className="text-xs text-white/50">{enabled ? "Enabled" : "Disabled"}</p>
                  </div>
                  {enabled ? <ToggleRight className="text-emerald-300" /> : <ToggleLeft className="text-white/40" />}
                </div>
              )
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Fallback email</p>
              <Input placeholder="alerts@company.com" defaultValue={settings.notify_email ?? ""} disabled />
              <p className="text-xs text-white/50">Editable once settings table is wired.</p>
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Webhook URL</p>
              <Input placeholder="https://hooks.slack.com/..." defaultValue={settings.webhook_url ?? ""} disabled />
              <p className="text-xs text-white/50">Read-only until backend settings are provisioned.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
