import React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold", {
  variants: {
    variant: {
      neutral: "bg-white/5 text-white/80 border border-white/10",
      success: "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30",
      warning: "bg-amber-500/15 text-amber-200 border border-amber-400/30",
      info: "bg-blue-500/15 text-blue-200 border border-blue-400/30",
      destructive: "bg-red-500/15 text-red-200 border border-red-400/30",
      outline: "border border-white/15 text-white/80",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
})

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
