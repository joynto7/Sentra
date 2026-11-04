import { Suspense } from "react"
import type { Metadata } from "next"

import { FindingsList } from "@/components/findings/findings-list"
import { TargetFrame } from "@/components/targets/target-frame"

export const metadata: Metadata = { title: "Target findings" }

export default async function TargetFindingsPage({ params }: PageProps<"/targets/[id]/findings">) {
  const { id } = await params
  return (
    <TargetFrame id={id} tab="findings" label="Findings">
      <Suspense>
        <FindingsList targetId={id} />
      </Suspense>
    </TargetFrame>
  )
}
