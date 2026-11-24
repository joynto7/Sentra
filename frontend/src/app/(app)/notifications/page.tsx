import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { NotificationsPage } from "@/components/notifications/notifications-page"

export const metadata: Metadata = { title: "Notifications" }

export default function AllNotificationsPage() {
  return (
    <>
      <PageHeader title="Notifications" />
      <NotificationsPage />
    </>
  )
}
