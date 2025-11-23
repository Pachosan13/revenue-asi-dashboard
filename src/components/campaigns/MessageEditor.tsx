"use client"

import React, { useState } from "react"
import { Sparkles, Split, Wand2 } from "lucide-react"
import { MessageVariant } from "@/types/campaign"
import { Button, Card, CardContent, Input } from "../ui-custom"

const quickActions = [
  { label: "Refine", hint: "Tighten phrasing" },
  { label: "Shorter", hint: "Compress to key ask" },
  { label: "Friendlier", hint: "Softer tone" },
  { label: "More direct", hint: "Lead with CTA" },
]

export function MessageEditor({ initialVariants }: { initialVariants: MessageVariant[] }) {
  const [variants, setVariants] = useState<MessageVariant[]>(initialVariants)

  const updateVariant = (id: string, field: keyof MessageVariant, value: string) => {
    setVariants((prev) => prev.map((variant) => (variant.id === id ? { ...variant, [field]: value } : variant)))
  }

  const addVariant = () => {
    if (variants.some((v) => v.label === "B")) return
    setVariants((prev) => [
      ...prev,
      {
        id: `variant-b-${Date.now()}`,
        label: "B",
        subject: "Variant B subject",
        body: "Alternate angle focusing on {{pain_point}} with direct CTA to book.",
      },
    ])
  }

  const applyQuickAction = (id: string, action: string) => {
    setVariants((prev) =>
      prev.map((variant) =>
        variant.id === id
          ? {
              ...variant,
              body: `${variant.body}\n\n[${action}: emphasize clarity and CTA timing]`,
            }
          : variant,
      ),
    )
  }

  return (
    <Card className="border-white/10 bg-black/40">
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/50">Message editor</p>
            <h3 className="text-xl font-semibold text-white">Copy lab</h3>
          </div>
          <Button variant="subtle" size="sm" className="gap-2" onClick={addVariant}>
            <Split size={16} /> Add variant B
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {variants.map((variant) => (
            <div key={variant.id} className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-sm font-semibold text-emerald-200 shadow-[0_0_30px_rgba(16,185,129,0.45)]">
                    {variant.label}
                  </div>
                  <div>
                    <p className="text-sm uppercase tracking-[0.12em] text-white/50">Variant {variant.label}</p>
                    <p className="text-white/80">Inbox preview + copy</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <Wand2 size={14} /> Smart fill
                </div>
              </div>

              <Input
                value={variant.subject ?? ""}
                onChange={(e) => updateVariant(variant.id, "subject", e.target.value)}
                placeholder="Subject line"
                className="border-white/10 bg-black/50"
              />
              <textarea
                value={variant.body}
                onChange={(e) => updateVariant(variant.id, "body", e.target.value)}
                className="min-h-[180px] w-full rounded-xl border border-white/10 bg-black/60 px-3 py-3 text-sm text-white/80 shadow-inner shadow-black/30 focus:border-emerald-400/50 focus:outline-none"
              />

              <div className="flex flex-wrap gap-2">
                {quickActions.map((action) => (
                  <Button
                    key={action.label}
                    variant="ghost"
                    size="sm"
                    className="border border-white/10 bg-white/5 text-xs text-white/70 hover:border-emerald-400/50"
                    onClick={() => applyQuickAction(variant.id, action.label)}
                  >
                    <Sparkles size={14} /> {action.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
