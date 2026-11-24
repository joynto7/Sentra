import { Suspense } from "react"
import type { Metadata } from "next"

import { RiskDashboard } from "@/components/risk/risk-dashboard"

export const metadata: Metadata = { title: "Risk Dashboard" }

export default function DashboardPage() {
  // The dashboard reads its filters from the address. The step-by-step setup is not here: it is the
  // /welcome flow, which a new account or a new member gets once, right after logging in.
  return (
    <Suspense>
      <RiskDashboard />
    </Suspense>
  )
}
