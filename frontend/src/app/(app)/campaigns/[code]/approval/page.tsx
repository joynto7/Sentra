import type { Metadata } from "next"

import { CampaignApprovalView } from "@/components/campaigns/approval-view"

export async function generateMetadata({ params }: PageProps<"/campaigns/[code]/approval">): Promise<Metadata> {
  const { code } = await params
  return { title: `${code} · Approval` }
}

export default async function CampaignApprovalPage({ params }: PageProps<"/campaigns/[code]/approval">) {
  const { code } = await params
  return <CampaignApprovalView code={code} />
}
