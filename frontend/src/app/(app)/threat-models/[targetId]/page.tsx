import type { Metadata } from "next"

import { ThreatModelReview } from "@/components/threat-models/threat-model-review"

export const metadata: Metadata = { title: "Threat model" }

/** Screen 26: one version of a target's threat model, reviewed and approved by a Security
 * Analyst (UC-3.1, UC-3.2). `?version=n` opens an earlier version, read-only. */
export default async function ThreatModel({ params, searchParams }: PageProps<"/threat-models/[targetId]">) {
  const { targetId } = await params
  const { version } = await searchParams
  const number = typeof version === "string" && /^\d{1,6}$/.test(version) ? Number(version) : null
  return <ThreatModelReview targetId={targetId} initialVersion={number} />
}
