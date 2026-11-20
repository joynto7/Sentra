import type { Metadata } from "next"

import { FindingActivity } from "@/components/findings/finding-activity"

export const metadata: Metadata = { title: "Finding activity" }

export default async function FindingActivityPage({ params }: PageProps<"/findings/[code]/activity">) {
  const { code } = await params
  return <FindingActivity code={code} />
}
