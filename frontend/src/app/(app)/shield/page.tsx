import type { Metadata } from "next"

import { GatewaysPage } from "@/components/shield/gateways-page"

export const metadata: Metadata = { title: "Sentra Shield" }

export default function ShieldPage() {
  return <GatewaysPage />
}
