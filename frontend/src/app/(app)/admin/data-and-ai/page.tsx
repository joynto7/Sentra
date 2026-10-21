import type { Metadata } from "next"

import { DataAndAiPage } from "@/components/admin/data-and-ai-page"

export const metadata: Metadata = { title: "Data and AI" }

/** Screen 59: LLM data sharing (UC-10.5), for Organization Administrators. */
export default function AdminDataAndAiPage() {
  return <DataAndAiPage />
}
