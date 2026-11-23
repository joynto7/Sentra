"use client"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { NotificationItems, NotificationTabs, useNotifications } from "@/components/notifications/notification-list"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { markAllRead } from "@/lib/notifications"

const PAGE = 20

/** All notifications ("View all notifications" in Screen 54), with the same filters and paging. */
export function NotificationsPage() {
  const { tab, setTab, unreadOnly, setUnreadOnly, items, total, unread, failed, load } = useNotifications(PAGE)
  usePageCrumbs([{ label: "Notifications" }])

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {unread === 1 ? "1 unread notification" : `${unread} unread notifications`}
        </p>
        {/* The count beside it says why there is nothing to mark */}
        <Button
          variant="outline"
          className="h-9"
          hidden={!unread}
          onClick={async () => {
            await markAllRead().catch(() => undefined)
            load()
          }}
        >
          Mark all as read
        </Button>
      </div>
      <section aria-label="Notifications" className="rounded-[10px] border bg-card">
        <NotificationTabs
          idPrefix="page"
          tab={tab}
          onTab={setTab}
          unreadOnly={unreadOnly}
          onUnreadOnly={setUnreadOnly}
          headerClassName="border-b px-4 py-1"
        >
          {failed ? (
            <Alert variant="destructive" role="alert" className="m-4 w-auto">
              <AlertDescription>The notifications could not be loaded. Reload the page to try again.</AlertDescription>
            </Alert>
          ) : items === null ? (
            <div className="space-y-2 p-4" role="status" aria-label="Loading notifications">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <NotificationItems items={items} tab={tab} onOpened={() => load()} />
          )}
        </NotificationTabs>
        {items && items.length < total && (
          <div className="border-t p-3 text-center">
            <Button variant="outline" className="h-9" onClick={() => load(items.length)}>
              Show {Math.min(PAGE, total - items.length)} more
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
