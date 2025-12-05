"use client"

import React, { useMemo, useState } from "react"
import { usePathname } from "next/navigation"
<<<<<<< HEAD
import { Menu, X, Home, Mails, Send, Activity, FlaskConical, Settings, Crown } from "lucide-react"
=======
import {
  Activity,
  FlaskConical,
  Home,
  Mails,
  Send,
  Settings,
  CalendarDays,
  X,
  Menu,
} from "lucide-react";
>>>>>>> origin/plan-joe-dashboard-v1
import { cn } from "@/lib/utils"
import { Button, Input } from "@/components/ui-custom"

const navItems = [
<<<<<<< HEAD
  { label: "Dashboard", href: "/dashboard", icon: Home, subtitle: "Operating picture" },
  { label: "Director Console", href: "/director", icon: Crown, subtitle: "CEO overview" },
  { label: "Leads Inbox", href: "/leads-inbox", icon: Mails, subtitle: "Inbox & actions" },
  { label: "Campaigns", href: "/campaigns", icon: Send, subtitle: "Outbound" },
  { label: "Prompt Lab", href: "/prompt-lab", icon: FlaskConical, subtitle: "Experiments" },
  { label: "Health", href: "/health", icon: Activity, subtitle: "Systems" },
  { label: "Settings", href: "/settings", icon: Settings, subtitle: "Org" },
]
=======
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: Home,
    subtitle: "Operating picture",
  },
  {
    label: "Leads",
    href: "/leads",
    icon: Mails,
    subtitle: "Pipeline & actions",
  },
  {
    label: "Appointments",
    href: "/appointments",
    icon: CalendarDays,
    subtitle: "Bookings & outcomes",
  },
  {
    label: "Voice Insights",
    href: "/voice-insights",
    icon: Activity,
    subtitle: "Calls & intents",
  },
  {
    label: "Campaigns",
    href: "/campaigns",
    icon: Send,
    subtitle: "Outbound",
  },
  {
    label: "Prompt Lab",
    href: "/prompt-lab",
    icon: FlaskConical,
    subtitle: "Experiments",
  },
  {
    label: "Health",
    href: "/health",
    icon: Activity,
    subtitle: "Systems",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    subtitle: "Org",
  },
];
>>>>>>> origin/plan-joe-dashboard-v1

export function AppShell({ children }: React.PropsWithChildren) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const current = useMemo(() => navItems.find((item) => pathname?.startsWith(item.href)), [pathname])

  return (
    <div className="relative isolate min-h-screen bg-[#05060a] text-white">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(94,234,212,0.15),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(129,140,248,0.08),transparent_35%),radial-gradient(circle_at_60%_80%,rgba(248,113,113,0.08),transparent_30%)]" />
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[260px,1fr]">
        <aside
          className={cn(
            "sticky top-0 z-40 flex h-screen flex-col gap-8 border-r border-white/10 bg-black/40 px-4 py-6 backdrop-blur lg:translate-x-0 lg:opacity-100",
            open ? "translate-x-0" : "-translate-x-full opacity-0",
            "transition duration-200 ease-out lg:relative lg:transition-none",
          )}
        >
          <div className="flex items-center justify-between px-2">
            <div className="text-lg font-semibold tracking-tight">Revenue ASI</div>
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </Button>
          </div>

          <div className="space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname?.startsWith(`${item.href}/`)
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-2xl px-3 py-3 transition",
                    active
                      ? "bg-emerald-500/15 text-white shadow-[0_10px_30px_rgba(16,185,129,0.35)]"
                      : "text-white/70 hover:bg-white/5",
                  )}
                >
                  <item.icon size={18} className={active ? "text-emerald-300" : "text-white/60"} />
                  <div className="flex flex-col">
                    <span className="font-semibold">{item.label}</span>
                    <span className="text-xs text-white/50">{item.subtitle}</span>
                  </div>
                  <div
                    className={cn(
                      "ml-auto h-2 w-2 rounded-full transition",
                      active ? "bg-emerald-400" : "bg-white/10 group-hover:bg-white/30",
                    )}
                  />
                </a>
              )
            })}
          </div>

          <div className="mt-auto space-y-3 rounded-2xl border border-white/5 bg-white/5 px-4 py-4">
            <p className="text-xs uppercase tracking-[0.16em] text-white/50">Focus</p>
            <p className="text-sm text-white/70">
              Stay on the critical signals. Summaries refresh every hour.
            </p>
            <Button variant="primary" size="sm" className="w-full">
              Quick briefing
            </Button>
          </div>
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-black/50 px-5 py-4 backdrop-blur">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="lg:hidden"
                onClick={() => setOpen((v) => !v)}
                aria-label="Toggle navigation"
              >
                {open ? <X size={18} /> : <Menu size={18} />}
              </Button>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-white/50">{current?.subtitle ?? "Overview"}</p>
                <h1 className="text-xl font-semibold text-white">{current?.label ?? "Revenue OS"}</h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Input placeholder="Search actions, leads..." className="hidden w-64 lg:block" />
              <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>Live</span>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
