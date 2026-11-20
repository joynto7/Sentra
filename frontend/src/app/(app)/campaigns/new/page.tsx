import type { Metadata } from "next"

import { CampaignBuilder } from "@/components/campaigns/campaign-builder"

export const metadata: Metadata = { title: "New Campaign" }

export default async function NewCampaignPage({ searchParams }: PageProps<"/campaigns/new">) {
  // "Launch campaign" on Getting started (Screen 07) also chooses the Quick Regression suite.
  const { target, suite } = await searchParams
  return (
    <CampaignBuilder
      target={typeof target === "string" ? target : undefined}
      suite={typeof suite === "string" ? suite : undefined}
    />
  )
}
