import type { Metadata } from "next"

import { GovernanceOverview } from "@/components/admin/governance-overview"

export const metadata: Metadata = { title: "Administration" }

/** Administration opens its overview: where the organization's setup stands, with a link to each part. */
export default function AdminPage() {
  return <GovernanceOverview />
}
