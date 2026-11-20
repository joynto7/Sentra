import { apiFetch } from "@/lib/api"

/** Types and API calls of notifications (M9, FR-9.3). */

export type NotificationItem = {
  id: string
  event: string
  text: string
  subject: string // shown in bold inside the text
  link: string | null
  count: number
  read_at: string | null
  last_event_at: string
}

export type NotificationList = { items: NotificationItem[]; total: number; unread_count: number }

export type Preference = { event: string; label: string; locked: boolean; in_app: boolean; email: boolean }

export type Tab = "" | "assigned" | "approvals"

export function listNotifications(options: { unread?: boolean; tab?: Tab; limit?: number; offset?: number }) {
  const params = new URLSearchParams()
  if (options.unread) params.set("unread", "true")
  if (options.tab) params.set("tab", options.tab)
  params.set("limit", String(options.limit ?? 20))
  params.set("offset", String(options.offset ?? 0))
  return apiFetch<NotificationList>(`/v1/notifications?${params}`)
}

export const unreadCount = () => apiFetch<{ unread_count: number }>("/v1/notifications/unread-count")
export const markRead = (id: string) => apiFetch<NotificationItem>(`/v1/notifications/${id}/read`, { method: "POST" })
export const markAllRead = () => apiFetch<{ marked: number }>("/v1/notifications/read-all", { method: "POST" })
export const getPreferences = () => apiFetch<Preference[]>("/v1/notifications/preferences")
export const savePreferences = (changes: { event: string; in_app: boolean; email: boolean }[]) =>
  apiFetch<Preference[]>("/v1/notifications/preferences", { method: "PUT", body: JSON.stringify(changes) })

/** "10:30" today, "7 Oct" this year, "7 Oct 2025" before. */
export function whenText(iso: string, now = new Date()): string {
  const date = new Date(iso)
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  }
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  })
}

export const isToday = (iso: string, now = new Date()) => new Date(iso).toDateString() === now.toDateString()
