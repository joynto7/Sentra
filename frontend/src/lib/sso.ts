import { apiFetch } from "@/lib/api"

const ORGANIZATION = "/v1/organizations/current/security/sso"

/** An organization's identity provider as Screen 11 shows it (UC-1.7). */
export type SsoConnection = {
  connected: boolean
  protocol: string
  email_domain: string | null
  issuer: string | null
  client_id: string | null
  tested_at: string | null
  /** The one address the provider may answer to; the administrator copies it into the provider. */
  redirect_uri: string
}

/** What the administrator types (UC-1.7 step 4). */
export type SsoDetails = {
  protocol: string
  email_domain: string
  issuer: string
  client_id: string
  client_secret: string
}

export type SsoTest = { ok: boolean; message: string }
export type SsoStart = { authorization_url: string | null; message: string | null }

export const testSso = (details: SsoDetails) =>
  apiFetch<SsoTest>(`${ORGANIZATION}/test`, { method: "POST", body: JSON.stringify(details) })

export const saveSso = (details: SsoDetails) =>
  apiFetch<SsoConnection>(ORGANIZATION, { method: "PUT", body: JSON.stringify(details) })

export const disconnectSso = () => apiFetch<SsoConnection>(ORGANIZATION, { method: "DELETE" })

/** UC-1.5 steps 1-2: where to send the browser, or why there is nowhere to send it (2a). */
export const startSso = (email: string) =>
  apiFetch<SsoStart>("/v1/auth/sso/start", { method: "POST", body: JSON.stringify({ email }) })

/**
 * Why a login through the provider did not finish. The callback is a page the browser is sent to,
 * so it can only carry a short reason in its address — the sentence belongs here, where it is read
 * (UC-1.5, 5a and 5b).
 */
export const SSO_PROBLEMS: Record<string, string> = {
  failed: "Single sign-on didn't work. Try again, or log in with your password.",
  expired: "That login took too long. Start again.",
  not_a_member:
    "Your company account was accepted, but you are not a member of this organization in Sentra. " +
    "Ask an Organization Administrator to invite you.",
}
