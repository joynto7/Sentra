import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { OnboardingPreview } from "@/components/wizard/preview/onboarding-preview"

export const metadata: Metadata = { title: "Component preview" }
// Read at request time: the preview exists only where a developer starts the server with SENTRA_COMPONENT_PREVIEW=1
export const dynamic = "force-dynamic"

/** A local preview of the shared guided-workflow components, with sample data only. Never reachable in a normal start. */
export default function OnboardingPreviewPage() {
  if (process.env.SENTRA_COMPONENT_PREVIEW !== "1") notFound()
  return <OnboardingPreview />
}
