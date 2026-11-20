import { redirect } from "next/navigation"

/** The platform opens its first built page, Accounts (Organizations comes with FR-10.4). */
export default function PlatformPage() {
  redirect("/platform/accounts")
}
