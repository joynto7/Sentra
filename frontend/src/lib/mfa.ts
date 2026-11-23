import { apiFetch } from "@/lib/api"
import type { SsoConnection } from "@/lib/sso"

/** Types and API calls of two-step verification (FR-1.2): Screens 02, 09, 10 and 11. */

/** What follows a correct password (UC-1.2): logged in, a code (steps 3-4), or the setup (3b). */
export type LoginStep = "done" | "mfa" | "mfa_setup"
export type LoginResult = { step: LoginStep; email: string; required_by: string[] }

/** UC-1.4 step 3, shown only during the setup. */
export type MfaSetup = { secret: string; uri: string; qr_code: string }
export type RecoveryCodes = { recovery_codes: string[] }

export type MfaStatus = {
  enabled: boolean
  enabled_at: string | null
  recovery_codes_left: number
  recovery_codes_total: number
  required_by: string[]
}

export type OrganizationSecurity = {
  mfa_required: boolean
  members_without_mfa: number
  /** FR-5.2 (M5): campaigns need a Security Manager's approval before they can run (UC-5.2) */
  requires_scope_approval: boolean
  /** How many people could give that approval; without one the requirement can't be turned on */
  security_managers: number
  password_confirmed_at: string | null
  password_confirmed_until: string | null
  /** The organization's identity provider (FR-1.3); Screen 11 is one page for both settings. */
  sso: SsoConnection
}

const post = (body?: unknown) => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) })

// The second step of a login (UC-1.2 steps 3-5; UC-1.4, 1a)
export const pendingLogin = () => apiFetch<LoginResult>("/v1/auth/login/mfa")
export const verifyCode = (code: string) => apiFetch<LoginResult>("/v1/auth/login/mfa", post({ code }))
export const verifyRecoveryCode = (recovery_code: string) =>
  apiFetch<LoginResult>("/v1/auth/login/mfa", post({ recovery_code }))
export const cancelLogin = () => apiFetch<null>("/v1/auth/login/mfa", { method: "DELETE" })
export const startSetupAtLogin = () => apiFetch<MfaSetup>("/v1/auth/login/mfa/setup", post())
export const enableAtLogin = (code: string) => apiFetch<RecoveryCodes>("/v1/auth/login/mfa/enable", post({ code }))

// In the profile (UC-1.4)
export const mfaStatus = () => apiFetch<MfaStatus>("/v1/account/mfa")
export const startSetup = (password: string) => apiFetch<MfaSetup>("/v1/account/mfa/setup", post({ password }))
export const enableMfa = (code: string) => apiFetch<RecoveryCodes>("/v1/account/mfa/enable", post({ code }))
export const renewRecoveryCodes = (password: string) =>
  apiFetch<RecoveryCodes>("/v1/account/mfa/recovery-codes", post({ password }))

// The organization (UC-1.7)
export const confirmPassword = (password: string) => apiFetch<null>("/v1/auth/confirm-password", post({ password }))
export const organizationSecurity = () => apiFetch<OrganizationSecurity>("/v1/organizations/current/security")
export const saveOrganizationSecurity = (mfa_required: boolean, requires_scope_approval?: boolean) =>
  apiFetch<OrganizationSecurity>("/v1/organizations/current/security", {
    method: "PUT",
    // FR-5.2 is left as it is when the page doesn't send it
    body: JSON.stringify({ mfa_required, requires_scope_approval }),
  })

/** The page that comes after a correct password; `next` is passed on to the workspace. */
export function secondStepPath(step: LoginStep, next?: string): string {
  const query = next ? `?next=${encodeURIComponent(next)}` : ""
  return step === "mfa_setup" ? `/login/two-step/setup${query}` : `/login/two-step${query}`
}

/** "JBSW Y3DP EHPK 3PXP …": the key in groups of four, easier to read and type (Screen 10). */
export function groupKey(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret
}

/** "Halcyon Bank requires …", "Halcyon Bank and Orion Health require …" */
export function requiredByHeading(organizations: string[]): string {
  if (organizations.length === 0) return "Set up two-step verification"
  if (organizations.length === 1) return `${organizations[0]} requires two-step verification`
  if (organizations.length === 2) return `${organizations.join(" and ")} require two-step verification`
  return `${organizations.length} of your organizations require two-step verification`
}

/** "1 member hasn't" / "3 members haven't" */
export function membersWithout(count: number): string {
  return count === 1 ? "1 member hasn't" : `${count} members haven't`
}

/** The text file of "Download .txt" (Screen 10, step 3). */
export function recoveryCodesText(codes: string[], email: string): string {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
  return [
    `Sentra recovery codes for ${email}`,
    `Generated ${date}`,
    "",
    "Each code lets you log in once without your authenticator app.",
    "Keep them somewhere safe. New codes replace all of these.",
    "",
    ...codes,
    "",
  ].join("\n")
}
