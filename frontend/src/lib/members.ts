import { apiFetch } from "@/lib/api"
import type { LoginStep } from "@/lib/mfa"
import type { CurrentOrganization, SessionUser } from "@/lib/session"

export type Member = {
  membership_id: string
  user_id: string
  name: string
  email: string
  role: string
  role_label: string
  mfa_enabled: boolean
  last_login_at: string | null
  joined_at: string
  is_you: boolean
}

export type Invitation = {
  id: string
  email: string
  role: string
  role_label: string
  invited_by: string | null
  status: "pending" | "expired"
  expires_at: string
  created_at: string
}

export type InvitationDetails = {
  organization: string
  email: string
  role: string
  role_label: string
  role_description: string
  invited_by: string | null
  has_account: boolean
  logged_in_as: string | null
}

export function listMembers() {
  return apiFetch<Member[]>("/v1/organizations/current/members")
}

export function changeRole(membershipId: string, role: string, password: string) {
  return apiFetch<Member>(`/v1/organizations/current/members/${membershipId}`, {
    method: "PATCH",
    body: JSON.stringify({ role, password }),
  })
}

export function removeMember(membershipId: string, password: string) {
  return apiFetch<null>(`/v1/organizations/current/members/${membershipId}/remove`, {
    method: "POST",
    body: JSON.stringify({ password }),
  })
}

export function listInvitations() {
  return apiFetch<Invitation[]>("/v1/organizations/current/invitations")
}

export function invite(email: string, role: string) {
  return apiFetch<Invitation>("/v1/organizations/current/invitations", {
    method: "POST",
    body: JSON.stringify({ email, role }),
  })
}

export function resendInvitation(id: string) {
  return apiFetch<Invitation>(`/v1/organizations/current/invitations/${id}/resend`, { method: "POST" })
}

export function revokeInvitation(id: string) {
  return apiFetch<null>(`/v1/organizations/current/invitations/${id}/revoke`, { method: "POST" })
}

// The invitation link's token goes in the request body, never in an API address (UC-1.9).
export function invitationDetails(token: string) {
  return apiFetch<InvitationDetails>("/v1/invitations/details", { method: "POST", body: JSON.stringify({ token }) })
}

export function acceptInvitation(token: string) {
  return apiFetch<CurrentOrganization>("/v1/invitations/accept", { method: "POST", body: JSON.stringify({ token }) })
}

/** The new account joins; `step` is "mfa_setup" when the organization requires two-step
 * verification, which is then set up before the first session (FR-1.2). */
export function registerAndAccept(token: string, name: string, password: string, acceptTerms: boolean) {
  return apiFetch<SessionUser & { step: LoginStep }>("/v1/invitations/register", {
    method: "POST",
    body: JSON.stringify({ token, name, password, accept_terms: acceptTerms }),
  })
}

export function declineInvitation(token: string) {
  return apiFetch<null>("/v1/invitations/decline", { method: "POST", body: JSON.stringify({ token }) })
}

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "Today 08:02", "Yesterday" or "7 Oct", as on the members page. */
export function lastSeen(iso: string | null, now = new Date()): string {
  if (!iso) return "Never"
  const date = new Date(iso)
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days <= 0) return `Today ${TIME.format(date)}`
  if (days === 1) return "Yesterday"
  return DAY.format(date)
}

/** "in 5 days", "tomorrow" or "today" for a pending invitation. */
export function expiresIn(iso: string, now = new Date()): string {
  const days = Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "tomorrow"
  return `in ${days} days`
}

export function firstName(name: string): string {
  return name.split(" ")[0] || name
}
