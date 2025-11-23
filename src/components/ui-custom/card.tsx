import React from "react"
import { cn } from "@/lib/utils"

export function Card({
  children,
  className,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-white/5/70 backdrop-blur-sm shadow-[0_10px_40px_rgba(0,0,0,0.25)]",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 px-6 pb-4 pt-5">
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm text-white/60">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export function CardContent({
  children,
  className,
}: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn("px-6 py-5", className)}>{children}</div>
}
