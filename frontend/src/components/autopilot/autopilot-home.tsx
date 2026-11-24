"use client"

import { useEffect, useState } from "react"

import { AutopilotHero } from "@/components/autopilot/autopilot-hero"
import { AutopilotList } from "@/components/autopilot/autopilot-list"
import { AutopilotStart } from "@/components/autopilot/autopilot-start"
import { type Autopilot, listAutopilot } from "@/lib/autopilot"

/** The page of the autopilot: how it goes, where to start one, and what has been assessed. The list is
 *  read once here, so the start card can say which targets are already being assessed. */
export function AutopilotHome() {
  const [runs, setRuns] = useState<Autopilot[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    listAutopilot(controller.signal)
      .then(setRuns)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="space-y-8">
      <AutopilotHero />
      <AutopilotStart runs={runs} />
      <AutopilotList runs={runs} failed={failed} />
    </div>
  )
}
