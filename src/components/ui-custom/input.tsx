import React from "react"
import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/40 shadow-inner shadow-black/30 transition focus:border-emerald-400/60 focus:outline-none",
        className,
      )}
      {...props}
    />
  )
})

Input.displayName = "Input"
