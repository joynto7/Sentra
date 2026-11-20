import { apiFetch } from "@/lib/api"

/** Types and API calls of the profile pages (FR-1.7, UC-1.11). */

export type Profile = {
  id: string
  name: string
  email: string
  pending_email: string | null
  phone: string | null
  password_changed_at: string | null
  created_at: string
}

export type SessionInfo = {
  id: string
  user_agent: string | null
  ip_address: string | null
  created_at: string
  last_seen_at: string
  current: boolean
}

export type AccountEvent = { kind: string; ip_address: string | null; user_agent: string | null; created_at: string }

const post = (body?: unknown) => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) })

export const getProfile = () => apiFetch<Profile>("/v1/account/profile")
export const updateProfile = (name: string, phone: string | null) =>
  apiFetch<Profile>("/v1/account/profile", { method: "PATCH", body: JSON.stringify({ name, phone }) })
export const requestEmailChange = (email: string, password: string) =>
  apiFetch<{ message: string }>("/v1/account/email", post({ email, password }))
export const cancelEmailChange = () => apiFetch<null>("/v1/account/email", { method: "DELETE" })
export const confirmEmailChange = (token: string) =>
  apiFetch<{ message: string }>("/v1/account/email/confirm", post({ token }))
export const changePassword = (current_password: string, new_password: string) =>
  apiFetch<null>("/v1/account/password", post({ current_password, new_password }))
export const listSessions = () => apiFetch<SessionInfo[]>("/v1/account/sessions")
export const endSession = (id: string) => apiFetch<null>(`/v1/account/sessions/${id}/end`, post())
export const endOtherSessions = () => apiFetch<{ message: string }>("/v1/account/sessions/end-others", post())
export const recentActivity = () => apiFetch<AccountEvent[]>("/v1/account/activity")

/** "Chrome on macOS" from a browser's user agent; a guess, good enough to recognise a device. */
export function describeAgent(agent: string | null): string {
  if (!agent) return "Unknown browser"
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
      ? "Opera"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Chrome\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : "A program"
  const system = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? "Android"
        : /Windows/.test(agent)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(agent)
            ? "macOS"
            : /Linux/.test(agent)
              ? "Linux"
              : ""
  return system ? `${browser} on ${system}` : browser
}

/** The events of "Recent activity", in the words of Screen 09. */
export const EVENT_LABEL: Record<string, string> = {
  logged_in: "Logged in",
  login_failed: "Failed login attempt (wrong password)",
  password_changed: "Password changed",
  password_reset: "Password reset with an e-mail link",
  email_change_requested: "New e-mail address requested",
  email_changed: "E-mail address changed",
  session_ended: "Another session logged out",
  other_sessions_ended: "All other sessions logged out",
  mfa_enabled: "Two-step verification turned on",
  mfa_failed: "Failed login attempt (wrong code)",
  recovery_code_used: "Logged in with a recovery code",
  recovery_codes_renewed: "New recovery codes generated",
}

/** "13 Oct 2026, 08:02" in the browser's time zone. */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
