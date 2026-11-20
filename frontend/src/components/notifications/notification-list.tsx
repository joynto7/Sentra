"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ClipboardCheck,
  FileText,
  Gauge,
  type LucideIcon,
  RefreshCcw,
  Rocket,
  ShieldAlert,
  TriangleAlert,
  UserRoundCheck,
} from "lucide-react"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  type NotificationItem,
  type Tab,
  isToday,
  listNotifications,
  markRead,
  whenText,
} from "@/lib/notifications"
import { cn } from "@/lib/utils"

const ICON: Record<string, LucideIcon> = {
  campaign_run_completed: Rocket,
  finding_critical_high: TriangleAlert,
  approval_requested: ClipboardCheck,
  finding_assigned: UserRoundCheck,
  retest_finished: RefreshCcw,
  report_ready: FileText,
  usage_limit_warning: Gauge,
  account_security: ShieldAlert,
}

const EMPTY: Record<string, string> = {
  "": "You're all caught up.",
  assigned: "Nothing is assigned to you.",
  approvals: "No approvals are waiting for you.",
}

/** The notifications of the user, with "Only unread" and the tabs (UC-9.3); the panel and the page share it. */
export function useNotifications(pageSize: number) {
  const [tab, setTab] = useState<Tab>("")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [items, setItems] = useState<NotificationItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [unread, setUnread] = useState(0)
  const [failed, setFailed] = useState(false)

  const load = useCallback(
    (offset = 0) => {
      listNotifications({ unread: unreadOnly, tab, limit: pageSize, offset })
        .then((page) => {
          setItems((current) => (offset ? [...(current ?? []), ...page.items] : page.items))
          setTotal(page.total)
          setUnread(page.unread_count)
          setFailed(false)
        })
        .catch(() => setFailed(true))
    },
    [unreadOnly, tab, pageSize],
  )
  useEffect(() => load(), [load])

  return { tab, setTab, unreadOnly, setUnreadOnly, items, total, unread, failed, load }
}

/** The sentence with the object in bold (Screen 54). */
function Sentence({ item }: { item: NotificationItem }) {
  const at = item.subject ? item.text.indexOf(item.subject) : -1
  if (at < 0) return <>{item.text}</>
  return (
    <>
      {item.text.slice(0, at)}
      <strong className="font-semibold text-foreground">{item.subject}</strong>
      {item.text.slice(at + item.subject.length)}
    </>
  )
}

/**
 * The tabs All / Assigned to me / Approvals with "Only unread"; the list is the content of the open
 * tab, so each tab is linked to its panel for screen readers.
 */
export function NotificationTabs({
  idPrefix,
  tab,
  onTab,
  unreadOnly,
  onUnreadOnly,
  headerClassName,
  children,
}: {
  idPrefix: string
  tab: Tab
  onTab: (tab: Tab) => void
  unreadOnly: boolean
  onUnreadOnly: (on: boolean) => void
  headerClassName?: string
  children: React.ReactNode
}) {
  const value = tab || "all"
  return (
    <Tabs value={value} onValueChange={(next) => onTab(next === "all" ? "" : (next as Tab))}>
      <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2", headerClassName)}>
        <TabsList variant="line" aria-label="Show" className="h-9 justify-start gap-4 px-0">
          <TabsTrigger value="all" className="flex-none px-0.5">
            All
          </TabsTrigger>
          <TabsTrigger value="assigned" className="flex-none px-0.5">
            Assigned to me
          </TabsTrigger>
          <TabsTrigger value="approvals" className="flex-none px-0.5">
            Approvals
          </TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          <Switch id={`${idPrefix}-unread`} checked={unreadOnly} onCheckedChange={onUnreadOnly} />
          <Label htmlFor={`${idPrefix}-unread`} className="text-xs font-normal">
            Only unread
          </Label>
        </div>
      </div>
      <TabsContent value={value} className="mt-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">
        {children}
      </TabsContent>
    </Tabs>
  )
}

/** The items, grouped under "Today" and "Earlier". Opening one marks it read and shows its item. */
export function NotificationItems({
  items,
  tab,
  onOpened,
}: {
  items: NotificationItem[]
  tab: Tab
  onOpened: (item: NotificationItem) => void
}) {
  const router = useRouter()

  async function open(item: NotificationItem) {
    if (!item.read_at) await markRead(item.id).catch(() => undefined) // UC-9.3 step 6
    onOpened(item)
    if (item.link) router.push(item.link) // the page checks the permissions again (FR-1.6)
  }

  if (items.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{EMPTY[tab]}</p>
  }
  const groups = [
    { title: "Today", items: items.filter((item) => isToday(item.last_event_at)) },
    { title: "Earlier", items: items.filter((item) => !isToday(item.last_event_at)) },
  ].filter((group) => group.items.length)

  return (
    <div>
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3 className="bg-muted/60 px-4 py-1.5 text-xs font-semibold text-muted-foreground">{group.title}</h3>
          <ul className="divide-y">
            {group.items.map((item) => {
              const Icon = ICON[item.event] ?? ShieldAlert
              const unread = !item.read_at
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => open(item)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", unread ? "font-medium text-foreground" : "text-text-secondary")}>
                        {unread && <span className="sr-only">Unread: </span>}
                        <Sentence item={item} />
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {whenText(item.last_event_at)}
                        {item.count > 1 && ` · ${item.count} events`}
                      </span>
                    </span>
                    {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
