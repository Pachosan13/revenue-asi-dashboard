"use client"

import React, { useState } from "react"
import { FlaskConical, Sparkles, Wand2 } from "lucide-react"
import { Button, Card, CardContent, CardHeader, Input, Textarea } from "@/components/ui-custom"

export default function PromptLabPage() {
  const [idea, setIdea] = useState("")
  const [result, setResult] = useState("Ready to cook new flows. Coming soon.")

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">Experiments</p>
          <h1 className="text-3xl font-semibold text-white">Prompt Lab</h1>
          <p className="text-sm text-white/60">
            Prototype outbound ideas, personalize snippets, and preview cadences with the neon sandbox.
          </p>
        </div>
        <div className="inline-flex gap-2">
          <Button variant="ghost" size="sm" className="gap-2">
            <Wand2 size={16} />
            Library
          </Button>
          <Button variant="primary" size="sm" className="gap-2">
            <Sparkles size={16} />
            New prompt
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Experiment builder"
            description="Sketch an experiment, set the target, and mark the outcome you want to test."
          />
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Hypothesis</p>
              <Input
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="e.g. SMS bump after call with AI persona"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.12em] text-white/50">Prompt draft</p>
              <Textarea
                rows={6}
                placeholder="Personalize using {{company}}, {{pain_point}}, and prior touch logs..."
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-white/60">
                <FlaskConical size={16} className="text-emerald-300" />
                Coming soon: auto-evaluate and deploy.
              </div>
              <Button
                variant="primary"
                size="sm"
                className="gap-2"
                onClick={() => setResult(idea ? `Pinned: ${idea}` : "Prototype queued")}
              >
                <Sparkles size={16} />
                Save prototype
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="Preview"
            description="Responses, guardrails, and routing will render here as we wire the engine."
          />
          <CardContent className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-inner shadow-black/30">
              <p className="text-sm text-white/70">{result}</p>
              <p className="mt-2 text-xs text-white/50">
                You will see token usage, variants, and expected impact once we plug the evaluator.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {["Cadence", "Channel mix", "Persona"].map((label) => (
                <div key={label} className="rounded-xl border border-white/5 bg-white/5 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-white/50">{label}</p>
                  <p className="text-sm text-white/70">Auto-calculated from recent wins</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
