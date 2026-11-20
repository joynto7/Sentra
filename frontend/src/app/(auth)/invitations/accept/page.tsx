import type { Metadata } from "next"

import { AcceptInvitation } from "@/components/auth/accept-invitation"

export const metadata: Metadata = { title: "Accept invitation" }

export default async function AcceptInvitationPage({ searchParams }: PageProps<"/invitations/accept">) {
  const { token } = await searchParams
  return <AcceptInvitation token={typeof token === "string" ? token : undefined} />
}
