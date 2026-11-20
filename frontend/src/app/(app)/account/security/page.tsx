import type { Metadata } from "next"

import { SecurityPage } from "@/components/account/security-page"

export const metadata: Metadata = { title: "Security" }

export default function AccountSecurityPage() {
  return <SecurityPage />
}
