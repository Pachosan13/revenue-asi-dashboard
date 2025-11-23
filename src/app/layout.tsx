import "./globals.css";
import React from "react";

export const metadata = {
  title: "Revenue ASI Dashboard",
  description: "AI campaign & lead ops",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-[#050507] text-white">
        <div className="min-h-screen">
          <header className="sticky top-0 z-50 border-b border-white/10 bg-black/40 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              <div className="text-lg font-semibold tracking-tight">
                Revenue ASI
              </div>
              <nav className="flex gap-4 text-sm text-white/70">
                <a href="/leads" className="hover:text-white">Leads</a>
                <a href="/campaigns" className="hover:text-white">Campaigns</a>
                <a href="/prompts" className="hover:text-white">Prompt Lab</a>
                <a href="/monitor" className="hover:text-white">Health</a>
                <a href="/settings" className="hover:text-white">Settings</a>
              </nav>
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-4 py-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
