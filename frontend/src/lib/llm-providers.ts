import { apiFetch } from "@/lib/api"

/** Screen 62: the LLM providers Sentra's own agents use (FR-10.3, UC-10.4). Keys are never
 * returned by the API — `has_api_key` is all a card knows. */
export type ProviderKind = "anthropic" | "openai" | "ollama" | "openai_compatible"

export type ProviderModel = {
  id: string
  /** The name the provider itself uses, e.g. "llama3.1:8b" */
  name: string
  /** What a person calls it, e.g. "Llama 3.1 8B" */
  label: string
  /** The functions this model serves, e.g. ["LLM judge"] */
  tasks: string[]
}

export type Provider = {
  id: string
  name: string
  kind: ProviderKind
  kind_label: string
  prefix: string
  base_url: string | null
  deployment: "external" | "local"
  has_api_key: boolean
  models: ProviderModel[]
  tested_at: string | null
  /** The reply of the last test, or why it failed */
  test_reply: string | null
  test_duration_ms: number | null
  test_cost_usd: string | null
  tasks: string[]
}

export type Assignment = {
  task: string
  function: string
  model_id: string | null
  model: string | null
  provider: string | null
  deployment: "external" | "local" | null
  since: string | null
  /** What the row warns about, e.g. the LLM judge's recommendation (UC-10.4, 4a1) */
  note: string
}

export type LLMConfiguration = {
  providers: Provider[]
  assignments: Assignment[]
  /** UC-10.4 step 6, the note on the page */
  recorded: string
}

export type TestResult = {
  ok: boolean
  model: string
  reply: string | null
  duration_ms: number
  cost_usd: string
  error: string | null
}

export type NewProvider = {
  kind: ProviderKind
  name: string
  base_url: string
  api_key: string
  models: { name: string; label: string }[]
}

const URL = "/v1/admin/platform/llm"

export const KINDS: { value: ProviderKind; label: string; hint: string }[] = [
  { value: "anthropic", label: "Anthropic", hint: "Claude models through Anthropic's API." },
  { value: "openai", label: "OpenAI", hint: "GPT models through OpenAI's API." },
  { value: "ollama", label: "Ollama", hint: "Models running on the platform itself." },
  {
    value: "openai_compatible",
    label: "Other OpenAI-compatible",
    hint: "Any server that speaks the OpenAI API, such as vLLM or LM Studio.",
  },
]

/** Anthropic and OpenAI are reached with a key; a server the platform operator runs is reached
 * at its address. */
export const needsApiKey = (kind: ProviderKind) => kind === "anthropic" || kind === "openai"
export const needsBaseUrl = (kind: ProviderKind) => kind === "ollama" || kind === "openai_compatible"

export const llmConfiguration = (signal?: AbortSignal) => apiFetch<LLMConfiguration>(URL, { signal })

/** UC-10.4 step 3: the harmless test request, before anything is saved. */
export const testConnection = (data: NewProvider) =>
  apiFetch<TestResult>(`${URL}/test`, { method: "POST", body: JSON.stringify(data) })

/** UC-10.4 step 5: saved only when its own test request works (3a1 otherwise). */
export const addProvider = (data: NewProvider) =>
  apiFetch<Provider>(`${URL}/providers`, { method: "POST", body: JSON.stringify(data) })

/** The test panel of a provider that is already configured, with its stored key. */
export const testProvider = (id: string, modelId?: string) =>
  apiFetch<TestResult>(`${URL}/providers/${id}/test${modelId ? `?model_id=${modelId}` : ""}`, {
    method: "POST",
  })

export const addModel = (id: string, model: { name: string; label: string }) =>
  apiFetch<ProviderModel>(`${URL}/providers/${id}/models`, { method: "POST", body: JSON.stringify(model) })

/** UC-10.4, 5a1: refused while a task still uses one of the provider's models. */
export const removeProvider = (id: string) => apiFetch<null>(`${URL}/providers/${id}`, { method: "DELETE" })

/** UC-10.4 step 4: the model of one task, from the next request on. */
export const assignModel = (task: string, providerModelId: string) =>
  apiFetch<Assignment>(`${URL}/tasks/${task}`, {
    method: "PUT",
    body: JSON.stringify({ provider_model_id: providerModelId }),
  })

/** "412 ms", "1.2 s" — the time a test request took, as the cards show it. */
export function duration(ms: number | null): string {
  if (ms === null) return ""
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** "$0.0021", "$0.00" — the cost of one request, which is 0 for a model on the platform. */
export function cost(usd: string | null): string {
  if (usd === null) return ""
  const value = Number(usd)
  if (value === 0) return "$0.00"
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`
}
