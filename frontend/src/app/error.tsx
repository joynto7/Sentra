"use client"

import { RouteError } from "@/components/layout/route-states"

/** For the pages without the app's shell: logging in, creating an organization. */
export default function ErrorPage(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen bg-background px-4 py-16">
      <RouteError {...props} home={{ href: "/", label: "Go to Sentra's start page" }} />
    </main>
  )
}
