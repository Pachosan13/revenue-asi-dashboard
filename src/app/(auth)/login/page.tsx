import { Suspense } from "react"
import LoginClient from "./LoginClient"

export default function LoginPage() {
  // Next requires useSearchParams() be inside a Suspense boundary.
  return (
    <Suspense fallback={<div className="min-h-screen w-full bg-black" />}>
      <LoginClient />
    </Suspense>
  )
}
