"use client"

import { useEffect } from "react"

export function EnsureRevenueAccountCookie() {
  useEffect(() => {
    try {
      // Tu app ya usa este key en Command OS:
      const id = localStorage.getItem("revenue_account_id")
      if (!id) return

      // Si ya está seteado, no hacemos nada
      if (document.cookie.includes("revenue_account_id=")) return

      document.cookie = `revenue_account_id=${encodeURIComponent(
        id
      )}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
    } catch {
      // noop
    }
  }, [])

  return null
}
