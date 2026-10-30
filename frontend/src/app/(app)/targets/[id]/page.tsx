import type { Metadata } from "next"

import { TargetOverview } from "@/components/targets/target-overview"

export const metadata: Metadata = { title: "Target" }

export default async function TargetPage({ params }: PageProps<"/targets/[id]">) {
  const { id } = await params
  return <TargetOverview id={id} />
}
