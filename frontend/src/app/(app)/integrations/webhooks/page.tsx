import type { Metadata } from "next"

import { WebhooksPage } from "@/components/integrations/webhooks-page"

export const metadata: Metadata = { title: "Webhooks" }

export default function WebhooksRoute() {
  return <WebhooksPage />
}
