import type { Metadata } from "next"

import { ConnectWizard } from "@/components/shield/connect-wizard"

export const metadata: Metadata = { title: "Connect Sentra Shield" }

export default async function ConnectShieldPage({ params }: PageProps<"/shield/connect/[id]">) {
  const { id } = await params
  return <ConnectWizard targetId={id} />
}
