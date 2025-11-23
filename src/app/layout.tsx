import "./globals.css"
import React from "react"
import { AppShell } from "@/components/navigation/AppShell"

export const metadata = {
  title: "Revenue ASI Dashboard",
  description: "AI campaign & lead ops",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
