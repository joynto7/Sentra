import type { Metadata } from "next"

import { RiskDashboard } from "@/components/risk/risk-dashboard"

export const metadata: Metadata = { title: "Risk Dashboard" }

export default function DashboardPage() {
  return <RiskDashboard />
}
