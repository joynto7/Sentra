"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { usePathname } from "next/navigation"

import { ApiError } from "@/lib/api"
import {
  decideAction,
  deleteConversation,
  getConversation,
  getStatus,
  listConversations,
  sendMessage,
  type ChatMessage,
  type ConversationSummary,
  type Status,
  type StreamEvent,
} from "@/lib/assistant"

const KEEP = "sentra.assistant"

type Kept = { open?: boolean; expanded?: boolean; conversationId?: string | null }

function readKept(): Kept {
  try {
    return JSON.parse(window.localStorage.getItem(KEEP) ?? "{}") as Kept
  } catch {
    return {}
  }
}

function writeKept(next: Kept) {
  try {
    window.localStorage.setItem(KEEP, JSON.stringify(next))
  } catch {
    // Private windows and blocked storage: the assistant works, it just doesn't come back open.
  }
}

type AssistantState = {
  open: boolean
  setOpen: (open: boolean) => void
  expanded: boolean
  setExpanded: (expanded: boolean) => void
  status: Status | null
  messages: ChatMessage[]
  busy: boolean
  error: string | null
  conversationId: string | null
  history: ConversationSummary[]
  send: (text: string) => void
  confirm: (actionId: string) => void
  cancel: (actionId: string) => void
  stop: () => void
  newChat: () => void
  openConversation: (id: string) => Promise<void>
  removeConversation: (id: string) => Promise<void>
  refreshHistory: () => Promise<void>
}

const Context = createContext<AssistantState | null>(null)

let counter = 0
const localId = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`

const blank = (role: ChatMessage["role"], extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: localId(role),
  role,
  content: "",
  steps: [],
  cards: [],
  suggestions: [],
  actions: [],
  ...extra,
})

/** The newest message is the one being answered, when it is an assistant message still pending. */
function withPending(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1]
  return last?.role === "assistant" && last.pending ? messages : [...messages, blank("assistant", { pending: true })]
}

function applyEvent(messages: ChatMessage[], event: StreamEvent): ChatMessage[] {
  switch (event.event) {
    case "step": {
      const next = withPending(messages)
      const last = next[next.length - 1]
      const known = last.steps.some((s) => s.id === event.step.id)
      const steps = known ? last.steps.map((s) => (s.id === event.step.id ? event.step : s)) : [...last.steps, event.step]
      return [...next.slice(0, -1), { ...last, steps }]
    }
    case "card": {
      const next = withPending(messages)
      const last = next[next.length - 1]
      return [...next.slice(0, -1), { ...last, cards: [...last.cards, event.card] }]
    }
    case "action": {
      const next = withPending(messages)
      const last = next[next.length - 1]
      return [...next.slice(0, -1), { ...last, actions: [...last.actions, event.action] }]
    }
    case "action_result": {
      const updated = messages.map((m) => ({
        ...m,
        actions: m.actions.map((a) => (a.id === event.action.id ? event.action : a)),
      }))
      const outcome: ChatMessage = { ...blank("event"), ...event.message, steps: [], suggestions: [], actions: [] }
      return [...updated, outcome]
    }
    case "message": {
      const next = withPending(messages)
      const last = next[next.length - 1]
      const final: ChatMessage = {
        ...last,
        id: event.message.id,
        content: event.message.content,
        suggestions: event.message.suggestions ?? [],
        mode: event.message.mode,
        actions: event.message.actions?.length ? event.message.actions : last.actions,
        pending: false,
        fresh: true,
      }
      return [...next.slice(0, -1), final]
    }
    default:
      return messages
  }
}

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpenState] = useState(false)
  const [expanded, setExpandedState] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [history, setHistory] = useState<ConversationSummary[]>([])
  const abort = useRef<AbortController | null>(null)
  const page = useRef(pathname)
  const loaded = useRef(false)
  const conversation = useRef<string | null>(null)

  useEffect(() => {
    page.current = pathname
  }, [pathname])

  const keep = useCallback((changes: Kept) => writeKept({ ...readKept(), ...changes }), [])

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listConversations())
    } catch {
      // The list is a convenience; the chat works without it.
    }
  }, [])

  const openConversation = useCallback(
    async (id: string) => {
      setError(null)
      try {
        const detail = await getConversation(id)
        conversation.current = detail.id
        setConversationId(detail.id)
        setMessages(detail.messages)
        keep({ conversationId: detail.id })
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) keep({ conversationId: null })
        else setError(cause instanceof ApiError ? cause.message : "I couldn't open that conversation.")
      }
    },
    [keep],
  )

  // The first time the panel opens: what the assistant can do for this person, the conversations
  // and, if they were in the middle of one, that conversation.
  const load = useCallback(async () => {
    if (loaded.current) return
    loaded.current = true
    try {
      setStatus(await getStatus())
    } catch {
      loaded.current = false
      return
    }
    void refreshHistory()
    const last = readKept().conversationId
    if (last) await openConversation(last)
  }, [openConversation, refreshHistory])

  // Restore how the panel was left, once, after the first paint (no mismatch with the server's).
  useEffect(() => {
    const kept = readKept()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after mount
    if (kept.expanded) setExpandedState(true)
    if (kept.open) {
      setOpenState(true)
      void load()
    }
  }, [load])

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      keep({ open: next })
      if (next) void load()
    },
    [keep, load],
  )

  const setExpanded = useCallback(
    (next: boolean) => {
      setExpandedState(next)
      keep({ expanded: next })
    },
    [keep],
  )

  // ⌘/ or Ctrl+/ opens and closes the assistant from anywhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault()
        setOpen(!open)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, setOpen])

  const run = useCallback(
    async (start: (onEvent: (event: StreamEvent) => void, signal: AbortSignal) => Promise<void>) => {
      const controller = new AbortController()
      abort.current = controller
      setBusy(true)
      setError(null)
      try {
        await start((event) => {
          if (event.event === "conversation") {
            conversation.current = event.conversation.id
            setConversationId(event.conversation.id)
            keep({ conversationId: event.conversation.id })
          } else if (event.event === "error") {
            setError(event.message)
            setMessages((all) => all.filter((m) => !(m.pending && !m.content && m.steps.length === 0)))
          } else {
            setMessages((all) => applyEvent(all, event))
          }
        }, controller.signal)
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof ApiError ? cause.message : "Something went wrong. Try again.")
        }
      } finally {
        // A turn that ended without an answer (stopped, or the connection dropped) leaves no
        // pending bubble behind: it keeps what it showed so far.
        setMessages((all) =>
          all.flatMap((m) =>
            m.pending ? (m.steps.length || m.cards.length || m.actions.length ? [{ ...m, pending: false }] : []) : [m],
          ),
        )
        setBusy(false)
        abort.current = null
        void refreshHistory()
      }
    },
    [keep, refreshHistory],
  )

  const send = useCallback(
    (text: string) => {
      const message = text.trim()
      if (!message || busy) return
      setMessages((all) => [...all, blank("user", { content: message }), blank("assistant", { pending: true })])
      void run((onEvent, signal) =>
        sendMessage({ message, conversation_id: conversation.current, page: page.current }, onEvent, signal),
      )
    },
    [busy, run],
  )

  const decide = useCallback(
    (actionId: string, decision: "confirm" | "cancel") => {
      if (busy) return
      setMessages((all) =>
        all.map((m) => ({
          ...m,
          actions: m.actions.map((a) => (a.id === actionId && decision === "confirm" ? { ...a, status: "running" as const } : a)),
        })),
      )
      void run((onEvent, signal) => decideAction(actionId, decision, page.current, onEvent, signal))
    },
    [busy, run],
  )

  const stop = useCallback(() => abort.current?.abort(), [])

  const newChat = useCallback(() => {
    abort.current?.abort()
    conversation.current = null
    setConversationId(null)
    setMessages([])
    setError(null)
    keep({ conversationId: null })
  }, [keep])

  const removeConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id)
      if (conversation.current === id) newChat()
      await refreshHistory()
    },
    [newChat, refreshHistory],
  )

  const value = useMemo<AssistantState>(
    () => ({
      open,
      setOpen,
      expanded,
      setExpanded,
      status,
      messages,
      busy,
      error,
      conversationId,
      history,
      send,
      confirm: (id) => decide(id, "confirm"),
      cancel: (id) => decide(id, "cancel"),
      stop,
      newChat,
      openConversation,
      removeConversation,
      refreshHistory,
    }),
    [open, setOpen, expanded, setExpanded, status, messages, busy, error, conversationId, history, send, decide, stop, newChat, openConversation, removeConversation, refreshHistory],
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useAssistant(): AssistantState {
  const value = useContext(Context)
  if (!value) throw new Error("useAssistant must be used inside AssistantProvider")
  return value
}
