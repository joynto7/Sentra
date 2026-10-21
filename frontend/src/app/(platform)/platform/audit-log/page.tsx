import type { Metadata } from "next"

import { AuditLogPage } from "@/components/audit-log/audit-log-page"
import { readQuery } from "@/lib/audit-log"

export const metadata: Metadata = { title: "Platform Audit Log" }

/** Screen 58 for Platform Administrators: the platform's own entries (UC-10.3, 1a). */
export default async function PlatformAuditLogPage({ searchParams }: PageProps<"/platform/audit-log">) {
  const params = await searchParams
  const entry = typeof params.entry === "string" && /^[0-9a-f-]{36}$/i.test(params.entry) ? params.entry : null
  return <AuditLogPage scope="platform" initialQuery={readQuery(params)} initialEntry={entry} />
}
