import type { Metadata } from "next"

import { CampaignsList, CreateCampaignButton } from "@/components/campaigns/campaigns-list"
import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Campaigns" }

export default function CampaignsPage() {
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Security assessments of your verified targets: what is tested, how much and how fast."
        action={<CreateCampaignButton />}
      />
      <CampaignsList />
    </>
  )
}
