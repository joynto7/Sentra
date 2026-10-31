import type { Metadata } from "next"

import { PolicyPage } from "@/components/shield/policy-page"

export const metadata: Metadata = { title: "Sentra Shield" }

export default async function TargetShieldPage({ params }: PageProps<"/targets/[id]/shield">) {
  const { id } = await params
  return <PolicyPage id={id} />
}
