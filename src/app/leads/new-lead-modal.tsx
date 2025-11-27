"use client"

import { useState } from "react"
import { Button, Card, CardContent, CardHeader, Input, Textarea } from "@/components/ui-custom"

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  supabase: ReturnType<any> | null
  onCreated?: () => void
}

export default function NewLeadModal({ open, onOpenChange, supabase, onCreated }: Props) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: "",
    phone_e164: "",
    company: "",
    notes: ""
  })

  if (!open) return null

  async function onSave() {
    if (!supabase) return
    if (!form.phone_e164.trim()) {
      alert("Phone E.164 requerido (ej: +50765699957)")
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase
        .from("leads")
        .insert({
          name: form.name || null,
          phone_e164: form.phone_e164.trim(),
          company: form.company || null,
          notes: form.notes || null,
          source: "manual",
          status: "new"
        })

      if (error) throw error

      onOpenChange(false)
      setForm({ name: "", phone_e164: "", company: "", notes: "" })
      onCreated?.()
    } catch (e) {
      console.error(e)
      alert("Error creando lead. Revisa consola.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <CardHeader className="text-lg font-semibold">New lead</CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            placeholder="Phone (E.164) e.g. +50765699957"
            value={form.phone_e164}
            onChange={(e) => setForm((f) => ({ ...f, phone_e164: e.target.value }))}
          />
          <Input
            placeholder="Company"
            value={form.company}
            onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
          />
          <Textarea
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={loading}>
              {loading ? "Saving..." : "Save lead"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
