import { API_URL, ApiError, apiFetch } from "@/lib/api"

/** Types and calls of the assistant (the chat that guides people and does their work). */

export type Tone = "neutral" | "good" | "warn" | "bad" | "info"
export type Badge = { label: string; tone: Tone }

/** A cell of a table card: text, or a badge. */
export type Cell = { text?: string; strong?: boolean; badge?: Badge }

export type Card =
  | {
      type: "table"
      title: string
      columns: string[]
      rows: { cells: Cell[]; href: string | null }[]
      total: number
      more_href: string | null
      more_label: string
    }
  | {
      type: "record"
      title: string
      subtitle: string
      badges: Badge[]
      facts: [string, string][]
      href: string | null
    }
  | {
      type: "metrics"
      title: string
      items: { label: string; value: number | string; tone: Tone }[]
      href?: string
    }
  | { type: "link"; title: string; description: string; href: string }

export type Step = {
  id: string
  tool: string
  label: string
  status: "running" | "done" | "failed"
  summary?: string
  href?: string | null
}

export type ActionStatus = "pending" | "running" | "done" | "failed" | "cancelled"
export type ActionView = {
  id: string
  tool: string
  summary: string
  risk: "normal" | "high"
  status: ActionStatus
  error: string | null
  fields: [string, string][]
}

export type Role = "user" | "assistant" | "event"
export type ChatMessage = {
  id: string
  role: Role
  content: string
  steps: Step[]
  cards: Card[]
  suggestions: string[]
  actions: ActionView[]
  mode?: "ai" | "guide"
  href?: string | null
  /** The answer is still being worked out: only steps and cards so far. */
  pending?: boolean
  /** Written in this session, so its text is revealed as it arrives; history is shown whole. */
  fresh?: boolean
}

export type Status = {
  available: boolean
  mode: "ai" | "guide"
  model: string | null
  deployment: "local" | "external" | null
  starters: string[]
  can_do: string[]
}

export type ConversationSummary = { id: string; title: string; updated_at: string }
export type ConversationDetail = { id: string; title: string; messages: ChatMessage[] }

export type StreamEvent =
  | { event: "conversation"; conversation: { id: string; title: string } }
  | { event: "step"; step: Step }
  | { event: "card"; card: Card }
  | { event: "action"; action: ActionView }
  | { event: "action_result"; action: ActionView; message: ChatMessage }
  | { event: "message"; message: Omit<ChatMessage, "steps" | "cards"> & Partial<ChatMessage> }
  | { event: "error"; message: string }

export const getStatus = () => apiFetch<Status>("/v1/assistant/status")
export const listConversations = () => apiFetch<ConversationSummary[]>("/v1/assistant/conversations")
export const getConversation = (id: string) => apiFetch<ConversationDetail>(`/v1/assistant/conversations/${id}`)
export const deleteConversation = (id: string) =>
  apiFetch<null>(`/v1/assistant/conversations/${id}`, { method: "DELETE" })

/**
 * Posts to a streaming endpoint (a turn of the chat, or a decision on an action) and calls
 * `onEvent` for each server-sent event as it arrives. Throws an ApiError when the server refuses
 * before the stream starts (a limit, a missing conversation).
 */
export async function stream(
  path: string,
  body: unknown,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error
    throw new ApiError(0, "network_error", "Sentra could not reach the server. Try again.")
  }
  if (!response.ok || !response.body) {
    const error = (await response.json().catch(() => null))?.error
    throw new ApiError(
      response.status,
      error?.code ?? `http_${response.status}`,
      error?.message ?? "Something went wrong. Try again.",
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let end: number
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("")
      if (data) onEvent(JSON.parse(data) as StreamEvent)
    }
  }
}

export const sendMessage = (
  body: { message: string; conversation_id?: string | null; page: string },
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
) => stream("/v1/assistant/chat", body, onEvent, signal)

export const decideAction = (
  id: string,
  decision: "confirm" | "cancel",
  page: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
) => stream(`/v1/assistant/actions/${id}`, { decision, page }, onEvent, signal)

/** A link in a card or a message is only ever a page of the app or an https address. */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null
  if (href.startsWith("/") && !href.startsWith("//")) return href
  return /^https:\/\//.test(href) ? href : null
}
