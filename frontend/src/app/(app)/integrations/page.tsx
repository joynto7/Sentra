import type { Metadata } from "next"

import { GatesPage } from "@/components/integrations/gates-page"

export const metadata: Metadata = { title: "Security Gates" }

export default function IntegrationsPage() {
  return <GatesPage />
}
