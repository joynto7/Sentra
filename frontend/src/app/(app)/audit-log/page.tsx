import type { Metadata } from "next"

import { AuditLogPage } from "@/components/audit-log/audit-log-page"
import { readQuery } from "@/lib/audit-log"

export const metadata: Metadata = { title: "Audit Log" }

/** Screen 58: the organization's audit log, for Organization Administrators (UC-10.3). */
export default async function OrganizationAuditLogPage({ searchParams }: PageProps<"/audit-log">) {
  const params = await searchParams
  const entry = typeof params.entry === "string" && /^[0-9a-f-]{36}$/i.test(params.entry) ? params.entry : null
  return <AuditLogPage scope="organization" initialQuery={readQuery(params)} initialEntry={entry} />
}
