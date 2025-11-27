"use client"

import { useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Textarea,
} from "@/components/ui-custom"

type NewLeadModalProps = {
  open: boolean
  onOpenChange: (v: boolean) => void
  supabase: SupabaseClient | null
  onCreated?: () => void
}

export default function NewLeadModal({
  open,
  onOpenChange,
  supabase,
  onCreated,
}: NewLeadModalProps) {
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
  })

  if (!open) return null

  async function handleSave() {
    if (!supabase) {
      alert("No hay Supabase configurado.")
      return
    }

    if (!form.phone.trim()) {
      alert("El teléfono es obligatorio.")
      return
    }

    setLoading(true)

    try {
      const { error } = await supabase.from("leads").insert({
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        state: "new",
      })

      if (error) throw error

      onOpenChange(false)
      setForm({ name: "", phone: "", email: "", notes: "" })
      onCreated?.()
    } catch (err) {
      console.error(err)
      alert("Error creando lead. Revisa consola.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-xl">
        <CardHeader
          title="New lead"
          description="Crear lead manual para probar el motor."
        />
        <CardContent className="space-y-3">
          <Input
            placeholder="Name (visual only)"
            value={form.name}
            onChange={(e) =>
              setForm((f) => ({ ...f, name: e.target.value }))
            }
          />

          <Input
            placeholder="Phone (E.164) ej. +50765699957"
            value={form.phone}
            onChange={(e) =>
              setForm((f) => ({ ...f, phone: e.target.value }))
            }
          />

          <Input
            placeholder="Email (opcional)"
            value={form.email}
            onChange={(e) =>
              setForm((f) => ({ ...f, email: e.target.value }))
            }
          />

          <Textarea
            placeholder="Notes (solo para ti, no se envía)"
            value={form.notes}
            onChange={(e) =>
              setForm((f) => ({ ...f, notes: e.target.value }))
            }
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save lead"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
