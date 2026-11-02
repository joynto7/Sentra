import type { Metadata } from "next"

import { ChangesPage } from "@/components/remediation/changes-page"

export const metadata: Metadata = { title: "Application changes" }

export default function ApplicationChangesPage() {
  return <ChangesPage />
}
