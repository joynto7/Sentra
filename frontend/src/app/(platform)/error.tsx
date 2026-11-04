"use client"

import { RouteError } from "@/components/layout/route-states"

export default function ErrorPage(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} home={{ href: "/platform", label: "Go to the platform pages" }} />
}
