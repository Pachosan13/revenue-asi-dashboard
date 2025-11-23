import React from "react"
import { cn } from "@/lib/utils"

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  icon?: React.ReactNode
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, icon, children, ...props }, ref) => {
  return (
    <div className="relative w-full">
      {icon ? <div className="pointer-events-none absolute left-3 top-2.5 text-white/50">{icon}</div> : null}
      <select
        ref={ref}
        className={cn(
          "w-full appearance-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white shadow-inner shadow-black/20 transition focus:border-emerald-400/60 focus:outline-none",
          icon ? "pl-9" : null,
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <div className="pointer-events-none absolute right-3 top-2.5 text-white/50">▾</div>
    </div>
  )
})

Select.displayName = "Select"
