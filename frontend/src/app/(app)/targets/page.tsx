import type { Metadata } from "next"

import { TargetsList } from "@/components/targets/targets-list"

export const metadata: Metadata = { title: "Targets" }

export default function TargetsPage() {
  return <TargetsList />
}
