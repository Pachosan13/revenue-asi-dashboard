"use client"

import React, { useState } from "react"
import { GripVertical, Mail, MessageCircle, Plus, Timer, Trash2, ArrowUp, ArrowDown } from "lucide-react"
import { CampaignTouch } from "@/types/campaign"
import { Button, Card, CardContent, Input, Select } from "../ui-custom"

const channelIcon: Record<CampaignTouch["channel"], React.ReactNode> = {
  email: <Mail size={16} />,
  sms: <MessageCircle size={16} />,
  whatsapp: <MessageCircle size={16} className="text-green-300" />,
}

export function CadenceBuilder({
  initialTouches,
  onChange,
}: {
  initialTouches: CampaignTouch[]
  onChange?: (touches: CampaignTouch[]) => void
}) {
  const [touches, setTouches] = useState<CampaignTouch[]>(initialTouches)

  const updateTouches = (next: CampaignTouch[]) => {
    setTouches(next)
    onChange?.(next)
  }

  const addTouch = () => {
    const nextOrder = touches.length + 1
    const newTouch: CampaignTouch = {
      id: `new-${nextOrder}-${Date.now()}`,
      order: nextOrder,
      channel: "email",
      delay: `+${nextOrder * 2} days`,
      title: "New touch",
      preview: "Personalized follow-up with {{first_name}}",
    }
    updateTouches([...touches, newTouch])
  }

  const removeTouch = (id: string) => {
    const next = touches.filter((touch) => touch.id !== id).map((touch, idx) => ({ ...touch, order: idx + 1 }))
    updateTouches(next)
  }

  const swapTouch = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= touches.length) return
    const next = [...touches]
    const temp = next[index]
    next[index] = { ...next[newIndex], order: index + 1 }
    next[newIndex] = { ...temp, order: newIndex + 1 }
    updateTouches(next)
  }

  const updateField = (id: string, field: keyof CampaignTouch, value: string) => {
    const next = touches.map((touch) => (touch.id === id ? { ...touch, [field]: value } : touch))
    updateTouches(next)
  }

  return (
    <Card className="border-white/10 bg-black/40">
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/50">Cadence builder</p>
            <h3 className="text-xl font-semibold text-white">Timeline</h3>
          </div>
          <Button variant="subtle" size="sm" className="gap-2" onClick={addTouch}>
            <Plus size={16} /> Add touch
          </Button>
        </div>

        <div className="space-y-3">
          {touches.map((touch, index) => (
            <div
              key={touch.id}
              className="relative flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5/80 p-4 backdrop-blur"
            >
              <div className="absolute -left-5 top-5 h-full w-px bg-gradient-to-b from-emerald-500/50 via-white/20 to-transparent" />
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white/70">
                  <GripVertical size={14} />
                  <span className="text-xs uppercase tracking-[0.16em] text-white/40">{touch.order}</span>
                </div>
                <Select
                  value={touch.channel}
                  onChange={(e) => updateField(touch.id, "channel", e.target.value)}
                  className="w-36 bg-black/50"
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                </Select>
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white/70">
                  <Timer size={14} className="text-emerald-300" />
                  <Input
                    value={touch.delay}
                    onChange={(e) => updateField(touch.id, "delay", e.target.value)}
                    className="w-28 border-none bg-transparent px-0"
                  />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => swapTouch(index, "up")}> 
                    <ArrowUp size={16} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => swapTouch(index, "down")}> 
                    <ArrowDown size={16} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => removeTouch(touch.id)}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={touch.title}
                  onChange={(e) => updateField(touch.id, "title", e.target.value)}
                  className="border-white/10 bg-black/50"
                  placeholder="Touch title"
                />
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white/70">
                  <div className="rounded-full bg-white/5 p-2 text-emerald-300">{channelIcon[touch.channel]}</div>
                  <p className="truncate text-sm text-white/70">{touch.preview}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
