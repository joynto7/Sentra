import type { Metadata } from "next"

import { RouteNotFound } from "@/components/layout/route-states"

export const metadata: Metadata = { title: "Page not found" }

export default function NotFound() {
  return <RouteNotFound home={{ href: "/dashboard", label: "Go to the Risk Dashboard" }} />
}
