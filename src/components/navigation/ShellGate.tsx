"use client"

import React from "react"

/**
 * ShellGate is a thin wrapper used by the root `src/app/layout.tsx`.
 *
 * Right now, route groups already handle their own layouts:
 * - `src/app/(app)/layout.tsx` wraps app pages with `AppShell`
 * - `src/app/(auth)/layout.tsx` wraps auth pages
 *
 * So this component intentionally acts as a pass-through.
 * If we later want to add global gating (e.g. auth/session checks),
 * this is the safe place to do it without changing layouts.
 */
export default function ShellGate({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}


