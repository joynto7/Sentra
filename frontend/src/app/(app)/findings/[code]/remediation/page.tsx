import type { Metadata } from "next"

import { RemediationView } from "@/components/remediation/remediation-view"

export const metadata: Metadata = { title: "Finding remediation" }

/** The same page as /remediation/{code}, inside the finding's tabs. */
export default async function FindingRemediationPage({ params }: PageProps<"/findings/[code]/remediation">) {
  const { code } = await params
  return <RemediationView code={code} inFinding />
}
