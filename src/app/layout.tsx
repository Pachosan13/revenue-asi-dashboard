// src/app/layout.tsx
import "./globals.css"
import type { Metadata } from "next"
import React from "react"

export const metadata: Metadata = {
  title: "Revenue ASI Dashboard",
  description: "AI campaign & lead ops",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full font-sans">{children}</body>
    </html>
  )
}
