import type { Metadata } from "next"

import { GateView } from "@/components/integrations/gate-view"

export const metadata: Metadata = { title: "Security Gate" }

export default async function GatePage({ params }: PageProps<"/integrations/gates/[code]">) {
  const { code } = await params
  return <GateView code={code} />
}
