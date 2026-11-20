import type { Metadata } from "next"

import { RecommendationsPage } from "@/components/threat-models/recommendations-page"

export const metadata: Metadata = { title: "Recommended test suites" }

/** Screen 27: the test suites that address the threats of the approved version (UC-3.3). */
export default async function Recommendations({ params }: PageProps<"/threat-models/[targetId]/recommendations">) {
  const { targetId } = await params
  return <RecommendationsPage targetId={targetId} />
}
