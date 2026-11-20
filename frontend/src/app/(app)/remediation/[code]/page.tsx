import type { Metadata } from "next"

import { RemediationView } from "@/components/remediation/remediation-view"

export async function generateMetadata({ params }: PageProps<"/remediation/[code]">): Promise<Metadata> {
  const { code } = await params
  return { title: `Remediation for ${code}` }
}

export default async function RemediationDetailPage({ params }: PageProps<"/remediation/[code]">) {
  const { code } = await params
  return <RemediationView code={code} />
}
