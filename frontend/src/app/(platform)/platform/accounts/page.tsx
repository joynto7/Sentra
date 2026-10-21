import type { Metadata } from "next"

import { AccountsPage } from "@/components/platform/accounts-page"

export const metadata: Metadata = { title: "Accounts" }

/** Screen 64: every Sentra account, for Platform Administrators (UC-10.2, 1a). */
export default async function PlatformAccountsPage({ searchParams }: PageProps<"/platform/accounts">) {
  const { q } = await searchParams
  return <AccountsPage initialSearch={typeof q === "string" ? q.slice(0, 200) : ""} />
}
