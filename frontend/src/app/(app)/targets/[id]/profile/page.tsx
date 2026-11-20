import type { Metadata } from "next"

import { ProfileReview } from "@/components/targets/profile-review"

export const metadata: Metadata = { title: "Target Profile" }

export default async function TargetProfilePage({ params }: PageProps<"/targets/[id]/profile">) {
  const { id } = await params
  return <ProfileReview id={id} />
}
