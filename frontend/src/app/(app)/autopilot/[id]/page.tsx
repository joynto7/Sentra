import type { Metadata } from "next"

import { AutopilotView } from "@/components/autopilot/autopilot-view"
import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Autopilot assessment" }

export default async function AutopilotRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <>
      <PageHeader title="Autopilot assessment" description="Every stage, what it waits for, and what it found." />
      <AutopilotView id={id} />
    </>
  )
}
