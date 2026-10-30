import type { Metadata } from "next"

import { RemediationList } from "@/components/remediation/remediation-list"

export const metadata: Metadata = { title: "Remediation" }

export default function RemediationPage() {
  return <RemediationList />
}
