import type { Metadata } from "next"

import { MembersPage } from "@/components/admin/members-page"

export const metadata: Metadata = { title: "Members" }

export default async function AdminMembersPage({ searchParams }: PageProps<"/admin/members">) {
  // "View members" on Organization Security opens the members without two-step verification;
  // the audit log opens a member (q) or the pending invitations (tab).
  const { mfa, q, tab } = await searchParams
  return (
    <MembersPage
      initialMfa={mfa === "on" || mfa === "off" ? mfa : ""}
      initialSearch={typeof q === "string" ? q.slice(0, 200) : ""}
      initialTab={tab === "invitations" ? "invitations" : "members"}
    />
  )
}
