import React from "react"
import { cn } from "@/lib/utils"

export function Table({ children, className }: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_15px_50px_rgba(0,0,0,0.35)]", className)}>
      <table className="min-w-full divide-y divide-white/5 text-sm text-white/80">{children}</table>
    </div>
  )
}

export function TableHead({ children }: React.PropsWithChildren) {
  return <thead className="sticky top-0 z-10 bg-black/50 backdrop-blur">{children}</thead>
}

export function TableHeaderCell({ children, className, onClick }: React.PropsWithChildren<{ className?: string; onClick?: () => void }>) {
  return (
    <th
      onClick={onClick}
      className={cn(
        "cursor-pointer select-none px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-white/60 transition hover:text-white",
        className,
      )}
    >
      {children}
    </th>
  )
}

export function TableBody({ children }: React.PropsWithChildren) {
  return <tbody className="divide-y divide-white/5">{children}</tbody>
}

export function TableRow({ children, className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("transition hover:bg-white/5", className)} {...props}>
      {children}
    </tr>
  )
}

export function TableCell({ children, className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-4 py-4 align-top text-sm", className)} {...props}>
      {children}
    </td>
  )
}
