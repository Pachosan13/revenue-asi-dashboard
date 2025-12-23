"use client"

import React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

function NavItem({ href, label }: { href: string; label: string }) {
  const pathname = usePathname()
  const active = pathname === href
  return (
    <Link
      href={href}
      className={`block rounded-lg px-3 py-2 text-sm ${
        active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"
      }`}
    >
      {label}
    </Link>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 border-r border-white/10 p-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Revenue ASI</div>
            <span className="text-[10px] rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-300">
              Live
            </span>
          </div>

          <div className="mt-4 space-y-1">
            <NavItem href="/dashboard" label="Dashboard" />
            <NavItem href="/director" label="Director Console" />
            <NavItem href="/leads" label="Leads" />
            <NavItem href="/appointments" label="Appointments" />
            <NavItem href="/voice-insights" label="Voice Insights" />
            <NavItem href="/campaigns" label="Campaigns" />
            <NavItem href="/billing" label="Billing" />
            <NavItem href="/settings" label="Settings" />
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1">
          <div className="border-b border-white/10 px-6 py-4">
            <div className="text-sm text-slate-300">Pipeline & actions</div>
          </div>
          <div className="px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
