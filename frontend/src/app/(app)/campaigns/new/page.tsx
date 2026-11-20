import type { Metadata } from "next"

import { CampaignBuilder } from "@/components/campaigns/campaign-builder"

export const metadata: Metadata = { title: "New Campaign" }

export default async function NewCampaignPage({ searchParams }: PageProps<"/campaigns/new">) {
  const { target } = await searchParams
  return <CampaignBuilder target={typeof target === "string" ? target : undefined} />
}
