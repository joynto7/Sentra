import type { Metadata } from "next"

import { ApiKeysPage } from "@/components/integrations/api-keys-page"

export const metadata: Metadata = { title: "API Keys" }

export default function IntegrationsPage() {
  return <ApiKeysPage />
}
