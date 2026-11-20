import type { Metadata } from "next"

import { CampaignView } from "@/components/campaigns/campaign-view"

export async function generateMetadata({ params }: PageProps<"/campaigns/[code]">): Promise<Metadata> {
  const { code } = await params
  return { title: code }
}

export default async function CampaignPage({ params }: PageProps<"/campaigns/[code]">) {
  const { code } = await params
  return <CampaignView code={code} />
}
