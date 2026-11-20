import type { Metadata } from "next"

import { ThreatModelsPage } from "@/components/threat-models/threat-models-page"

export const metadata: Metadata = { title: "Threat Models" }

/** Screen 25: the threat model of every target (UC-3.1 to UC-3.4). */
export default function ThreatModels() {
  return <ThreatModelsPage />
}
