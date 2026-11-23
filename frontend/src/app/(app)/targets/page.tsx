import { Suspense } from "react"
import type { Metadata } from "next"

import { TargetsList } from "@/components/targets/targets-list"

export const metadata: Metadata = { title: "Targets" }

export default function TargetsPage() {
  // The list reads its tab, filters, order and page from the address
  return (
    <Suspense>
      <TargetsList />
    </Suspense>
  )
}
