import type { Metadata } from "next"

import { CampaignsList, CreateCampaignButton } from "@/components/campaigns/campaigns-list"
import { TargetFrame } from "@/components/targets/target-frame"
import { TargetTestJourney } from "@/components/targets/target-test-journey"

export const metadata: Metadata = { title: "Target campaigns" }

export default async function TargetCampaignsPage({ params }: PageProps<"/targets/[id]/campaigns">) {
  const { id } = await params
  return (
    <TargetFrame id={id} tab="campaigns" label="Campaigns">
      <TargetTestJourney targetId={id} />
      <div className="mb-4 flex justify-end empty:hidden">
        <CreateCampaignButton targetId={id} />
      </div>
      <CampaignsList targetId={id} />
    </TargetFrame>
  )
}
