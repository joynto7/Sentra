import type { Metadata } from "next"

import { TargetHistory } from "@/components/targets/target-history"

export const metadata: Metadata = { title: "Target history" }

export default async function TargetHistoryPage({ params }: PageProps<"/targets/[id]/history">) {
  const { id } = await params
  return <TargetHistory id={id} />
}
