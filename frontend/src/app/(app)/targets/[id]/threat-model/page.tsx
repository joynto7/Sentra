import type { Metadata } from "next"

import { ThreatModelReview } from "@/components/threat-models/threat-model-review"

export const metadata: Metadata = { title: "Target threat model" }

/** The same page as /threat-models/{id}, inside the target's tabs. */
export default async function TargetThreatModelPage({ params }: PageProps<"/targets/[id]/threat-model">) {
  const { id } = await params
  return <ThreatModelReview targetId={id} initialVersion={null} inTarget />
}
