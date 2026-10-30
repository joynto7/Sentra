import type { Metadata } from "next"

import { VerifyTargetPage } from "@/components/targets/verify-page"

export const metadata: Metadata = { title: "Verify ownership" }

export default async function VerifyPage({ params }: PageProps<"/targets/[id]/verify">) {
  const { id } = await params
  return <VerifyTargetPage id={id} />
}
