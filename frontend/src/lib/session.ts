import type { Role } from "@/config/navigation"

/** The organization this browser works in, with the user's role in it (FR-1.4). */
export type CurrentOrganization = {
  id: string
  name: string
  slug: string
  role: Role
  role_label: string
  is_current: boolean
}

/** The logged-in user, as returned by GET /api/v1/auth/me. */
export type SessionUser = {
  id: string
  name: string
  email: string
  status: string
  organization: CurrentOrganization | null
  /** Operates Sentra itself and has the platform pages (report 2.4); not an organization role. */
  platform_admin: boolean
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}
