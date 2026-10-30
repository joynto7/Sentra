import { Suspense } from "react"
import type { Metadata } from "next"

import { FindingsList } from "@/components/findings/findings-list"

export const metadata: Metadata = { title: "Findings" }

export default function FindingsPage() {
  return (
    <Suspense>
      <FindingsList />
    </Suspense>
  )
}
