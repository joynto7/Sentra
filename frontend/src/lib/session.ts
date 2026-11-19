import type { Role } from "@/config/navigation"

/** The logged-in user, as returned by GET /api/v1/auth/me. */
export type SessionUser = {
  id: string
  name: string
  email: string
  status: string
}

/**
 * Placeholder until organizations and roles exist (FR-1.4, FR-1.6).
 * Fictional sample data, the same as in the UI prototype.
 */
export const placeholderMembership: { role: Role; roleLabel: string; organization: string } = {
  role: "org_admin",
  roleLabel: "Organization Administrator",
  organization: "Halcyon Bank",
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
