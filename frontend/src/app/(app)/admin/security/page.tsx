import type { Metadata } from "next"

import { OrganizationSecurityPage } from "@/components/admin/organization-security-page"

export const metadata: Metadata = { title: "Organization Security" }

export default function AdminSecurityPage() {
  return <OrganizationSecurityPage />
}
