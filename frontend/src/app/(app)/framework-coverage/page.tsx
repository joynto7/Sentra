import type { Metadata } from "next"

import { FrameworkCoverage } from "@/components/risk/framework-coverage"

export const metadata: Metadata = { title: "Framework Coverage" }

export default function FrameworkCoveragePage() {
  return <FrameworkCoverage />
}
