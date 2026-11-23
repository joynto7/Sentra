import type { Metadata } from "next"

import { RouteNotFound } from "@/components/layout/route-states"

export const metadata: Metadata = { title: "Page not found" }

export default function NotFound() {
  return (
    <main className="min-h-screen bg-background px-4 py-16">
      <RouteNotFound home={{ href: "/", label: "Go to Sentra's start page" }} />
    </main>
  )
}
