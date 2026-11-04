import type { Metadata } from "next"

import { FrameworkCoverage } from "@/components/risk/framework-coverage"

export const metadata: Metadata = { title: "Framework Coverage" }

export default async function FrameworkCoveragePage({ searchParams }: PageProps<"/framework-coverage">) {
  // A target's page links here with that target.
  const { target } = await searchParams
  return <FrameworkCoverage initialTarget={typeof target === "string" ? target : undefined} />
}
