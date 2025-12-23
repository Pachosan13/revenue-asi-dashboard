"use client"

import React, { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  CalendarDays,
  Crown,
  FlaskConical,
  Home,
  Menu,
  Mails,
  PhoneCall,
  Send,
  Settings,
  Stethoscope,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge, Button, Input } from "@/components/ui-custom"

type AppShellProps = {
  children: React.ReactNode
}

type NavItem = {
  label: string
  href: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  subtitle?: string
}

const overviewNav: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: Home,
    subtitle: "Operating picture",
  },
  {
    label: "Director Console",
    href: "/director",
    icon: Crown,
    subtitle: "CEO overview",
  },
]

const pipelineNav: NavItem[] = [
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
    icon: PhoneCall,
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
]

const systemsNav: NavItem[] = [
  {
    label: "Health",
    href: "/health",
    icon: Stethoscope,
    subtitle: "Systems",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    subtitle: "Org",
  },
]

function NavSection({
  title,
  items,
  onNavigate,
  pathname,
}: {
  title: string
  items: NavItem[]
  onNavigate?: () => void
  pathname: string
}) {
  return (
    <div className="space-y-2">
      <p className="px-2 text-[11px] font-medium uppercase tracking-[0.16em] text-white/40">
        {title}
      </p>
      <div className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group flex items-center justify-between rounded-xl px-3 py-2 text-sm transition",
                active
                  ? "bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/60 shadow-[0_0_20px_rgba(16,185,129,0.35)]"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-xl border text-xs transition",
                    active
                      ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-100"
                      : "border-white/10 bg-white/5 text-white/70 group-hover:border-white/30"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex flex-col">
                  <span className="font-medium leading-tight">
                    {item.label}
                  </span>
                  {item.subtitle ? (
                    <span className="text-[11px] text-white/45">
                      {item.subtitle}
                    </span>
                  ) : null}
                </div>
              </div>
              {active ? (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              ) : null}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-gradient-to-b from-slate-950 via-black to-slate-900 text-white">
      {/* SIDEBAR */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-white/10 bg-gradient-to-b from-slate-950/95 to-black/95 px-4 py-4 backdrop-blur-xl transition-transform",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/20 ring-1 ring-emerald-400/60">
              <Activity className="h-4 w-4 text-emerald-300" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">
                Revenue ASI
              </p>
              <p className="text-[11px] text-white/45">
                Pipeline director & brain
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="flex items-center gap-2 border-emerald-400/60 bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-100"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Live
          </Badge>
        </div>

        <div className="mb-4">
          <Input
            placeholder="Search actions, leads..."
            className="h-9 border-white/15 bg-white/5 text-sm placeholder:text-white/40"
          />
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto pb-6">
          <NavSection
            title="Overview"
            items={overviewNav}
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
          <NavSection
            title="Pipeline & actions"
            items={pipelineNav}
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
          <NavSection
            title="Systems"
            items={systemsNav}
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
        </div>

        <div className="mt-auto border-t border-white/10 pt-3 text-[11px] text-white/40">
          <p>Estado en tiempo casi real del motor de Revenue ASI.</p>
        </div>
      </aside>

      {/* MOBILE TOGGLE */}
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        className="fixed left-3 top-3 z-50 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/60 text-white shadow-lg backdrop-blur lg:hidden"
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* MAIN AREA */}
      <div className="flex min-h-screen flex-1 flex-col lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-gradient-to-r from-black/80 via-slate-950/80 to-black/80 px-5 py-3 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-white/50">
              <span className="hidden text-[11px] uppercase tracking-[0.16em] text-white/45 sm:inline">
                Pipeline & actions
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="flex items-center gap-2 border-white/20 bg-white/5 text-[11px] text-white/70"
              >
                <Activity className="h-3 w-3" />
                Engine ok · summaries refresh every hour
              </Badge>
            </div>
          </div>
        </header>

        <main className="flex-1 px-5 pb-10 pt-5">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  )
}
