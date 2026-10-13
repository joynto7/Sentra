import { apiFetch } from "@/lib/api"

export type TargetType = "chatbot" | "rag_application" | "tool_using_agent"
export type Environment = "staging" | "production"
export type TargetStatus = "unverified" | "verified" | "archived"
export type RequestFormat = "openai_chat" | "custom_json"
export type CredentialType = "api_key" | "bearer_token" | "custom_header"
/** How Sentra authenticates; "none" means the target needs no credentials. */
export type AuthMode = CredentialType | "none"

export type StoredCredential = {
  name: string
  credential_type: CredentialType
  masked_value: string
  saved_at: string
}

export type Target = {
  id: string
  name: string
  type: TargetType
  endpoint_url: string
  endpoint_host: string
  environment: Environment
  max_request_rate: number
  request_format: RequestFormat
  request_template: string | null
  reply_path: string
  tool_calls_path: string | null
  status: TargetStatus
  owner: { id: string; name: string } | null
  credentials: StoredCredential[]
  created_at: string
  updated_at: string
}

export type TargetList = {
  items: Target[]
  total: number
  page: number
  page_size: number
  counts: { active: number; archived: number }
}

export type CredentialInput = { credential_type: CredentialType; name: string; value: string }

export const TYPE_LABEL: Record<TargetType, string> = {
  chatbot: "Chatbot",
  rag_application: "RAG application",
  tool_using_agent: "Tool-using agent",
}

export const TYPE_DESCRIPTION: Record<TargetType, string> = {
  chatbot: "Answers users in a conversation",
  rag_application: "Answers from your documents or knowledge base",
  tool_using_agent: "Calls tools or APIs to take actions",
}

export const ENVIRONMENT_LABEL: Record<Environment, string> = { staging: "Staging", production: "Production" }

export const AUTH_LABEL: Record<AuthMode, string> = {
  api_key: "API key in a header",
  bearer_token: "Bearer token",
  custom_header: "Custom headers",
  none: "No credentials needed",
}

export const MAX_RATE = 600
export const PLACEHOLDERS = ["message", "session_id"]
export const OPENAI_REPLY_PATH = "$.choices[0].message.content"
export const EXAMPLE_TEMPLATE = '{"session": "{{session_id}}", "input": "{{message}}"}'

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g
const PATH = /^\$(?:\.[A-Za-z_][\w-]*|\[\d+\]|\[['"][^'"]+['"]\])+$/
const HEADER = /^[A-Za-z0-9-]{1,100}$/
const RESERVED = new Set(["host", "content-length", "content-type", "transfer-encoding", "connection"])

// The same checks as the API (FR-2.1), so most mistakes show up before anything is sent.
export function nameProblem(name: string): string | undefined {
  const clean = name.trim()
  if (!clean) return "Enter a name."
  if (clean.length > 120) return "Use at most 120 characters."
}

export function urlProblem(url: string): string | undefined {
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error()
    if (parsed.username || parsed.password) {
      return "Don't put a user name or password in the URL. Add them as credentials."
    }
  } catch {
    return "Enter a URL that starts with https:// or http://."
  }
}

export function rateProblem(rate: string): string | undefined {
  const n = Number(rate)
  if (!rate.trim() || !Number.isInteger(n) || n < 1 || n > MAX_RATE) {
    return `Enter a rate between 1 and ${MAX_RATE} requests per minute.`
  }
}

export function templateProblem(template: string): string | undefined {
  const text = template.trim()
  if (!text) return "Describe the request body, with {{message}} where Sentra's message goes."
  const names = [...text.matchAll(PLACEHOLDER)].map((m) => m[1])
  const unknown = names.find((n) => !PLACEHOLDERS.includes(n))
  if (unknown) return `Unknown placeholder {{${unknown}}}. Use {{message}} or {{session_id}}.`
  if (!names.includes("message")) return "Add {{message}} where Sentra's message goes."
  let body: unknown
  try {
    body = JSON.parse(text.replace(PLACEHOLDER, "x"))
  } catch {
    return 'The template must be valid JSON, with placeholders in quotes: "{{message}}".'
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return 'The template must be a JSON object, such as {"input": "{{message}}"}.'
  }
}

export function pathProblem(path: string, required: boolean): string | undefined {
  const text = path.trim()
  if (!text) return required ? "Enter where the reply is, for example $.output.text." : undefined
  if (!PATH.test(text)) return "Use a path such as $.output.text."
}

export function credentialProblems(mode: AuthMode, rows: CredentialInput[]): Record<string, string> {
  const errors: Record<string, string> = {}
  if (mode === "none") return errors
  const seen = new Set<string>()
  rows.forEach((row, i) => {
    if (mode !== "bearer_token") {
      const name = row.name.trim()
      if (!HEADER.test(name)) errors[`credentials.${i}.name`] = "Use a header name with letters, digits and dashes, such as X-Api-Key."
      else if (RESERVED.has(name.toLowerCase())) errors[`credentials.${i}.name`] = "Sentra sets this header itself. Use another one."
      else if (seen.has(name.toLowerCase())) errors[`credentials.${i}.name`] = "Each header can be used only once."
      seen.add(name.toLowerCase())
    }
    if (!row.value.trim()) errors[`credentials.${i}.value`] = "Enter the secret."
    else if (/[\r\n\0]/.test(row.value)) errors[`credentials.${i}.value`] = "The value can't contain line breaks."
  })
  return errors
}

export function credentialsPayload(mode: AuthMode, rows: CredentialInput[]): CredentialInput[] {
  if (mode === "none") return []
  return rows.map((row) => ({ ...row, credential_type: mode, name: mode === "bearer_token" ? "Authorization" : row.name.trim() }))
}

/** One line describing a stored credential, never its value (FR-2.2). */
export function describeCredential(credential: StoredCredential): string {
  if (credential.credential_type === "bearer_token") return "Bearer token"
  if (credential.credential_type === "api_key") return `API key in header ${credential.name}`
  return `Header ${credential.name}`
}

export function listTargets(params: URLSearchParams, signal?: AbortSignal) {
  return apiFetch<TargetList>(`/v1/targets?${params}`, { signal })
}

export function getTarget(id: string) {
  return apiFetch<Target>(`/v1/targets/${id}`)
}

export function registerTarget(body: unknown) {
  return apiFetch<Target>("/v1/targets", { method: "POST", body: JSON.stringify(body) })
}

export function updateTarget(id: string, body: unknown) {
  return apiFetch<Target>(`/v1/targets/${id}`, { method: "PATCH", body: JSON.stringify(body) })
}

export function replaceCredentials(id: string, credentials: CredentialInput[]) {
  return apiFetch<Target>(`/v1/targets/${id}/credentials`, {
    method: "PUT",
    body: JSON.stringify({ credentials }),
  })
}

export function checkEndpoint(endpoint_url: string) {
  return apiFetch<{ endpoint_url: string }>("/v1/targets/check-endpoint", {
    method: "POST",
    body: JSON.stringify({ endpoint_url }),
  })
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
