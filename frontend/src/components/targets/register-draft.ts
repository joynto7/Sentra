import type { FormatValue } from "@/components/targets/format-fields"
import { type AuthMode, type Environment, type TargetType, TYPE_LABEL } from "@/lib/targets"
import { type DraftAdapter, DraftUnsupportedError } from "@/components/wizard/use-draft-feedback"

/**
 * What an unfinished target registration may keep in this browser: the identity and the connection
 * format, and which way of authenticating was chosen. NEVER a credential value: the credentials step
 * has no field here, so a draft cannot hold one, and a restored draft asks for them again.
 */
export type RegisterDraft = {
  step: number
  type: TargetType | ""
  name: string
  endpoint: string
  environment: Environment
  rate: string
  format: FormatValue
  mode: AuthMode
}

type Stored = { v: 1; savedAt: string; data: RegisterDraft }

export const registerDraftKey = (userId: string, organizationId: string) => `sentra.target-draft.v1:${userId}:${organizationId}`

const MODES: AuthMode[] = ["none", "api_key", "bearer_token", "custom_header"]

/** The draft, if there is one that still makes sense: unknown types, modes or shapes are dropped. */
export function loadRegisterDraft(key: string): { savedAt: string; data: RegisterDraft } | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const found = JSON.parse(raw) as Stored
    if (found?.v !== 1 || !found.data) return null
    const d = found.data
    const type = d.type === "" || d.type in TYPE_LABEL ? d.type : ""
    const environment = d.environment === "production" ? "production" : "staging"
    const mode = MODES.includes(d.mode) ? d.mode : "api_key"
    const format: FormatValue = {
      request_format: d.format?.request_format === "custom_json" ? "custom_json" : "openai_chat",
      request_template: String(d.format?.request_template ?? ""),
      reply_path: String(d.format?.reply_path ?? ""),
      tool_calls_path: String(d.format?.tool_calls_path ?? ""),
    }
    return {
      savedAt: found.savedAt,
      data: { step: Math.min(Math.max(Number(d.step) || 1, 1), 3), type, name: String(d.name ?? ""), endpoint: String(d.endpoint ?? ""), environment, rate: String(d.rate ?? "20"), format, mode },
    }
  } catch {
    return null
  }
}

export function clearRegisterDraft(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // nothing kept, nothing to remove
  }
}

export function registerDraftAdapter(key: string): DraftAdapter<RegisterDraft> {
  return {
    save(draft) {
      try {
        const savedAt = new Date().toISOString()
        window.localStorage.setItem(key, JSON.stringify({ v: 1, savedAt, data: draft } satisfies Stored))
        return { savedAt }
      } catch {
        throw new DraftUnsupportedError("This browser doesn't allow a draft to be kept")
      }
    },
  }
}
