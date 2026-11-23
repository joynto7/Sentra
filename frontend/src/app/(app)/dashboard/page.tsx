import { Suspense } from "react"
import type { Metadata } from "next"

import { RiskDashboard } from "@/components/risk/risk-dashboard"

export const metadata: Metadata = { title: "Risk Dashboard" }

export default function DashboardPage() {
  // The dashboard reads its filters from the address
  return (
    <Suspense>
      <RiskDashboard />
    </Suspense>
  )
}
