"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { FlaskConical, Sparkles, Wand2, X } from "lucide-react"
import { Button, Card, CardContent, CardHeader, Input, Textarea } from "@/components/ui-custom"
import { supabaseBrowser } from "@/lib/supabase"

type PromptPrototype = {
  id: string
  created_at?: string | null
  hypothesis?: string | null
  prompt_draft?: string | null
  status?: string | null
}

export default function PromptLabPage() {
  const supabase = useMemo(() => {
    const hasEnv = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    return hasEnv ? supabaseBrowser() : null
  }, [])

  const [idea, setIdea] = useState("")
  const [promptDraft, setPromptDraft] = useState("")
  const [result, setResult] = useState("Ready to cook new flows. Coming soon.")
  const [prototypes, setPrototypes] = useState<PromptPrototype[]>([])
  const [loading, setLoading] = useState(true)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [selectedPrototype, setSelectedPrototype] = useState<PromptPrototype | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)

  const loadPrototypes = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from("prompt_prototypes")
      .select("id, created_at, hypothesis, prompt_draft, status")
      .order("created_at", { ascending: false })
      .limit(20)

    if (error) {
      console.warn("Failed to load prototypes", error)
      setPrototypes([])
    } else {
      setPrototypes(data ?? [])
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPrototypes()
  }, [loadPrototypes])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(id)
  }, [toast])

  const handleSave = async () => {
    if (!idea && !promptDraft) return
    const optimistic: PromptPrototype = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      hypothesis: idea,
      prompt_draft: promptDraft,
      status: "draft",
    }

    setSaving(true)
    setPrototypes((prev) => [optimistic, ...prev].slice(0, 20))
    setSelectedPrototype(optimistic)
    setResult(idea ? `Pinned: ${idea}` : "Prototype queued")

    if (!supabase) {
      setToast({ type: "error", message: "Supabase env missing. Saved locally only." })
      setSaving(false)
      return
    }

    const { data, error } = await supabase
      .from("prompt_prototypes")
      .insert({ hypothesis: idea, prompt_draft: promptDraft, status: "draft" })
      .select()
      .maybeSingle()

    if (error) {
      console.error("Failed to save prototype", error)
      setToast({ type: "error", message: "Save failed" })
      setPrototypes((prev) => prev.filter((row) => row.id !== optimistic.id))
    } else if (data) {
      setPrototypes((prev) => [data, ...prev.filter((row) => row.id !== optimistic.id)])
      setSelectedPrototype(data)
      setToast({ type: "success", message: "Prototype saved" })
    }

    setSaving(false)
  }

  const handleSelect = (prototype: PromptPrototype) => {
    setIdea(prototype.hypothesis ?? "")
    setPromptDraft(prototype.prompt_draft ?? "")
    setSelectedPrototype(prototype)
    setResult(prototype.hypothesis ? `Loaded: ${prototype.hypothesis}` : "Prototype loaded")
    setLibraryOpen(false)
  }

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
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => setLibraryOpen(true)}>
            <Wand2 size={16} />
            Library
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="gap-2"
            onClick={() => {
              setIdea("")
              setPromptDraft("")
              setSelectedPrototype(null)
              setResult("Ready to cook new flows. Coming soon.")
            }}
          >
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
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
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
                onClick={handleSave}
                disabled={saving}
              >
                <Sparkles size={16} />
                {saving ? "Saving..." : "Save prototype"}
              </Button>
            </div>
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

        <Card>
          <CardHeader
            title="Preview"
            description="Responses, guardrails, and routing will render here as we wire the engine."
          />
          <CardContent className="space-y-4">
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
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
              {selectedPrototype ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-white/60">
                    <span>Status: {selectedPrototype.status ?? "draft"}</span>
                    <span>
                      {selectedPrototype.created_at
                        ? new Date(selectedPrototype.created_at).toLocaleString()
                        : "Pending"}
                    </span>
                  </div>
                  <p className="font-semibold text-white">{selectedPrototype.hypothesis}</p>
                  <p className="text-xs text-white/60">{selectedPrototype.prompt_draft}</p>
                </div>
              ) : (
                <p className="text-white/60">Select a prototype from the library to preview metadata.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {libraryOpen ? (
        <div className="fixed inset-0 z-40 flex items-start justify-end bg-black/60 backdrop-blur-sm">
          <div className="h-full w-full max-w-md border-l border-white/10 bg-slate-900/90 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-white/50">Library</p>
                <h3 className="text-lg font-semibold text-white">Saved prototypes</h3>
              </div>
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => setLibraryOpen(false)}>
                <X size={16} />
                Close
              </Button>
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((row) => (
                  <div key={row} className="h-12 animate-pulse rounded-xl bg-white/5" />
                ))}
              </div>
            ) : prototypes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-emerald-400/40 bg-white/5 px-5 py-6 text-center">
                <p className="text-lg font-semibold text-white">No prototypes yet</p>
                <p className="text-sm text-white/60">Save a hypothesis to see it here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {prototypes.map((prototype) => {
                  const status = (prototype.status ?? "draft").toLowerCase()
                  return (
                    <button
                      key={prototype.id}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-emerald-400/60"
                      onClick={() => handleSelect(prototype)}
                    >
                      <p className="font-semibold text-white">{prototype.hypothesis ?? "Untitled prototype"}</p>
                      <p className="text-xs text-white/50">{prototype.prompt_draft ?? "No prompt yet"}</p>
                      <div className="mt-1 flex items-center justify-between text-xs text-white/60">
                        <span className="uppercase tracking-[0.14em]">{status}</span>
                        <span>
                          {prototype.created_at
                            ? new Date(prototype.created_at).toLocaleDateString()
                            : "Pending"}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
