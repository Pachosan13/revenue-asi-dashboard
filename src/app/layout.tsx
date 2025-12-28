import "./globals.css"
import type { Metadata } from "next"
import React from "react"
import ShellGate from "@/components/navigation/ShellGate"

export const metadata: Metadata = {
  title: "Revenue ASI Dashboard",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full font-sans">
        <ShellGate>{children}</ShellGate>
      </body>
    </html>
  )
}
