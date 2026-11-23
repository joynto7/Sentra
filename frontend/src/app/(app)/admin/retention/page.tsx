import type { Metadata } from "next"

import { RetentionPage } from "@/components/admin/retention-page"

export const metadata: Metadata = { title: "Data Retention" }

/** Screen 60: the retention periods of the organization (UC-10.7, UC-10.8). */
export default function AdminRetentionPage() {
  return <RetentionPage />
}
