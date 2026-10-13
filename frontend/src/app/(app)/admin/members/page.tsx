import type { Metadata } from "next"

import { MembersPage } from "@/components/admin/members-page"

export const metadata: Metadata = { title: "Members" }

export default async function AdminMembersPage({ searchParams }: PageProps<"/admin/members">) {
  // "View members" on Organization Security opens the members without two-step verification.
  const mfa = (await searchParams).mfa
  return <MembersPage initialMfa={mfa === "on" || mfa === "off" ? mfa : ""} />
}
