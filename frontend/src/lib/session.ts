import type { Role } from "@/config/navigation"

export type SessionUser = {
  name: string
  role: Role
  roleLabel: string
  organization: string
}

/**
 * Placeholder for the logged-in user until login is built (FR-1.1, M1).
 * Fictional sample data, the same as in the UI prototype.
 */
export const currentUser: SessionUser = {
  name: "Tom Becker",
  role: "org_admin",
  roleLabel: "Organization Administrator",
  organization: "Halcyon Bank",
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}
