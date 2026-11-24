import type { Metadata } from "next"

import { PlatformSteps } from "@/components/hub/platform-steps"

export const metadata: Metadata = { title: "Platform" }

/** The Platform Administrator's start: the platform's own next steps, separate from any organization. */
export default function PlatformPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform</h1>
        <p className="mt-1 text-sm text-muted-foreground">Operating Sentra: services, LLM providers, organizations and accounts.</p>
      </div>
      <PlatformSteps />
    </div>
  )
}
