import { apiFetch } from "@/lib/api"

/** One account on the Accounts page (Screen 64): account data only, never an organization's
 * content (NFR-3.3). */
export type Account = {
  id: string
  name: string
  email: string
  /** Each organization with the account's membership status in it */
  organizations: { name: string; status: string }[]
  mfa_enabled: boolean
  last_login_at: string | null
  /** The newest login came from an address the account hadn't used in the 30 days before. */
  last_login_new_address: boolean
  status: "active" | "suspended"
  suspended_at: string | null
  suspension_reason: string | null
  platform_admin: boolean
}

export type AccountPage = { items: Account[]; total: number; page: number; page_size: number }

export const ACCOUNTS_PAGE_SIZE = 25

export function listAccounts(search: string, status: string, page: number) {
  const params = new URLSearchParams({ page: String(page), page_size: String(ACCOUNTS_PAGE_SIZE) })
  if (search.trim()) params.set("search", search.trim())
  if (status) params.set("status", status)
  return apiFetch<AccountPage>(`/v1/admin/platform/accounts?${params}`)
}

/** UC-10.2, 1a: suspended in every organization at once, confirmed with the password. */
export function suspendAccount(id: string, reason: string, password: string) {
  return apiFetch<Account>(`/v1/admin/platform/accounts/${id}/suspend`, {
    method: "POST",
    body: JSON.stringify({ reason, password }),
  })
}

/** UC-10.2, 1b: the memberships the platform suspended return with their previous roles. */
export function reactivateAccount(id: string, password: string) {
  return apiFetch<Account>(`/v1/admin/platform/accounts/${id}/reactivate`, {
    method: "POST",
    body: JSON.stringify({ password }),
  })
}

/** "Halcyon Bank and Kestrel Logistics", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}
