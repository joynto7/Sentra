import type { Metadata } from "next"

import { CampaignsList, CreateCampaignButton } from "@/components/campaigns/campaigns-list"
import { CampaignDraftEntry } from "@/components/campaigns/campaign-draft-entry"
import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Campaigns" }

export default function CampaignsPage() {
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Tests run on your verified targets."
        action={<CreateCampaignButton />}
      />
      <CampaignDraftEntry />
      <CampaignsList />
    </>
  )
}
