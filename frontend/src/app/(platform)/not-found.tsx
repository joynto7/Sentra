import type { Metadata } from "next"

import { RouteNotFound } from "@/components/layout/route-states"

export const metadata: Metadata = { title: "Page not found" }

export default function NotFound() {
  return <RouteNotFound home={{ href: "/platform", label: "Go to the platform pages" }} />
}
