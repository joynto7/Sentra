"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Bell, Settings } from "lucide-react"

import { NotificationItems, NotificationTabs, useNotifications } from "@/components/notifications/notification-list"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { markAllRead, unreadCount } from "@/lib/notifications"

const CHECK_EVERY = 60_000 // the unread count is refreshed every minute and when the window gets focus

/** Screen 54: the bell in the top bar and the notification centre that drops down from it. */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)

  const refresh = useCallback(() => {
    unreadCount()
      .then((result) => setCount(result.unread_count))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, CHECK_EVERY)
    window.addEventListener("focus", refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [refresh])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) refresh()
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={count ? `Notifications, ${count} unread` : "Notifications"}>
          <Bell aria-hidden="true" />
          {count > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-destructive-foreground"
              aria-hidden="true"
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] max-w-[calc(100vw-1rem)] p-0" aria-labelledby="notification-centre-heading">
        {open && <Panel onCount={setCount} onClose={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  )
}

function Panel({ onCount, onClose }: { onCount: (count: number) => void; onClose: () => void }) {
  const { tab, setTab, unreadOnly, setUnreadOnly, items, unread, failed, load } = useNotifications(20)

  useEffect(() => onCount(unread), [unread, onCount])

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h2 id="notification-centre-heading" className="text-[15px] font-semibold">
          Notifications
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="link"
            className="h-8 px-2 text-xs"
            disabled={!unread}
            onClick={async () => {
              await markAllRead().catch(() => undefined)
              load()
            }}
          >
            Mark all as read
          </Button>
          <Button asChild variant="ghost" size="icon" className="size-8">
            <Link href="/account/profile#notifications" aria-label="Notification settings" onClick={onClose}>
              <Settings aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
      <NotificationTabs
        idPrefix="panel"
        tab={tab}
        onTab={setTab}
        unreadOnly={unreadOnly}
        onUnreadOnly={setUnreadOnly}
        headerClassName="border-b px-4 pb-1"
      >
        <div className="max-h-[min(420px,60vh)] overflow-y-auto">
          {failed ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
              The notifications could not be loaded. Try again in a moment.
            </p>
          ) : items === null ? (
            <div className="space-y-2 p-4" role="status" aria-label="Loading notifications">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <NotificationItems items={items} tab={tab} onOpened={onClose} />
          )}
        </div>
      </NotificationTabs>
      <div className="border-t px-4 py-2.5 text-center">
        <Link href="/notifications" className="text-sm font-medium text-link hover:underline" onClick={onClose}>
          View all notifications
        </Link>
      </div>
    </div>
  )
}
