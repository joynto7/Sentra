import { Suspense } from "react"
import type { Metadata } from "next"

import { MembersPage } from "@/components/admin/members-page"

export const metadata: Metadata = { title: "Members" }

export default function AdminMembersPage() {
  // The list reads its tab, filters, order and page from the address
  return (
    <Suspense>
      <MembersPage />
    </Suspense>
  )
}
