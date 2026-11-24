import type { Metadata } from "next"

import { AutopilotHome } from "@/components/autopilot/autopilot-home"
import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Autopilot" }

export default function AutopilotPage() {
  return (
    <>
      <PageHeader
        title="Autopilot"
        description="One assessment of a verified target, from the threat model to the remediation proposals. You decide every approval."
      />
      <AutopilotHome />
    </>
  )
}
