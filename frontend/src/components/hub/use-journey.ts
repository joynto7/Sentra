"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { type Can, type JourneyTask, buildJourney } from "@/components/hub/journey"
import { useSession } from "@/components/session-provider"
import { listCampaigns } from "@/lib/campaigns"
import { getFirstSteps } from "@/lib/getting-started"
import { loadRoles } from "@/lib/permissions"
import { listTargets } from "@/lib/targets"

const REFRESH_MS = 60_000

/**
 * The first steps of the person's own organization, from what the server says now: the first-steps
 * state, the targets, the campaigns, and what the person's role may do (the API's permission table).
 * It asks again when the tab is looked at again and every minute, so a changed policy, resource or
 * membership shows up without a reload; a failed refresh keeps the last answer and says so. It is
 * made for one organization: the panel is keyed by it, so nothing of another one is ever shown.
 */
export function useJourney() {
  const session = useSession()
  const organizationId = session.organization?.id ?? null
  const role = session.organization?.role ?? null
  const [tasks, setTasks] = useState<JourneyTask[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [partial, setPartial] = useState(false)
  const [announce, setAnnounce] = useState("")
  const [attempt, setAttempt] = useState(0)
  const before = useRef<Map<string, string>>(new Map())

  const load = useCallback(
    async (isCurrent: () => boolean) => {
      const [roles, steps, targets, campaigns] = await Promise.allSettled([
        loadRoles(),
        getFirstSteps(),
        listTargets(new URLSearchParams({ tab: "active", page_size: "100" })),
        listCampaigns(),
      ])
      if (!isCurrent()) return
      if (roles.status !== "fulfilled" || steps.status !== "fulfilled" || targets.status !== "fulfilled") {
        setFailed(true)
        return
      }
      const allowed = new Set((roles.value.find((one) => one.role === role)?.permissions ?? []).map((p) => p.action))
      const can: Can = {
        manageMembers: allowed.has("manage_members"),
        manageTargets: allowed.has("manage_targets"),
        verifyTargets: allowed.has("verify_targets"),
        manageCampaigns: allowed.has("manage_campaigns"),
        generateReports: allowed.has("generate_reports"),
        manageOrganizationSecurity: allowed.has("manage_organization_security"),
      }
      const items = targets.value.items
      const named = (list: typeof items) => list.map((one) => ({ id: one.id, name: one.name }))
      const built = buildJourney({
        can,
        members: steps.value.members,
        openInvitations: steps.value.open_invitations,
        targets: {
          total: items.length,
          unverified: named(items.filter((one) => one.status === "unverified")),
          verified: named(items.filter((one) => one.status === "verified")),
        },
        campaignRunFinished: steps.value.campaign_run_finished,
        awaiting: campaigns.status === "fulfilled" ? campaigns.value.filter((row) => row.approval_status === "awaiting_approval").map((row) => ({ code: row.code, name: row.name })) : [],
      })
      // A step that was open and is now done is said once, so that a screen reader hears the change
      const finished = built.filter((task) => task.state === "done" && before.current.get(task.id) && before.current.get(task.id) !== "done")
      if (finished.length > 0) setAnnounce(`Step done: ${finished.map((task) => task.title).join(", ")}.`)
      before.current = new Map(built.map((task) => [task.id, task.state]))
      setTasks(built)
      setPartial(campaigns.status !== "fulfilled")
      setFailed(false)
    },
    [role],
  )

  useEffect(() => {
    if (!organizationId) return
    let current = true
    const isCurrent = () => current
    const first = setTimeout(() => void load(isCurrent), 0)
    const again = () => document.visibilityState === "visible" && void load(isCurrent)
    const timer = setInterval(again, REFRESH_MS)
    document.addEventListener("visibilitychange", again)
    window.addEventListener("focus", again)
    return () => {
      current = false
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener("visibilitychange", again)
      window.removeEventListener("focus", again)
    }
  }, [load, organizationId, attempt])

  return { tasks, failed, partial, announce, retry: () => setAttempt((n) => n + 1) }
}
