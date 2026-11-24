"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Ban, Check, CircleDot, Info, TriangleAlert } from "lucide-react"

import { AdminNav } from "@/components/admin/admin-nav"
import { type GovernanceInput, type ItemState, governanceChecklist, needsAttention } from "@/components/admin/governance-readiness"
import { EmptyState } from "@/components/layout/empty-state"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { useSession } from "@/components/session-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getDataSharing } from "@/lib/data-and-ai"
import { listInvitations, listMembers } from "@/lib/members"
import { organizationSecurity } from "@/lib/mfa"
import { useCan } from "@/lib/permissions"
import { getRetention } from "@/lib/retention"
import { cn } from "@/lib/utils"

const LOOK: Record<ItemState, { icon: typeof Check; word: string; tone: string }> = {
  done: { icon: Check, word: "Done", tone: "text-success" },
  attention: { icon: TriangleAlert, word: "Needs attention", tone: "text-warning" },
  optional: { icon: CircleDot, word: "Optional", tone: "text-muted-foreground" },
  info: { icon: Info, word: "Setting", tone: "text-muted-foreground" },
}

/**
 * Where the organization's setup stands, read from its real configuration, with a direct link to the
 * page that changes each part. Optional things stay optional; nothing is marked done by being
 * opened; a reading that could not be made is said so instead of being filled in.
 */
export function GovernanceOverview() {
  usePageCrumbs([{ label: "Administration" }])
  const organization = useSession().organization
  const canManage = useCan("manage_organization_security")
  const [input, setInput] = useState<GovernanceInput | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!canManage) return
    let alive = true
    Promise.allSettled([listMembers(), listInvitations(), organizationSecurity(), getRetention(), getDataSharing()]).then(
      ([members, invitations, security, retention, data]) => {
        if (!alive) return
        if (members.status === "rejected" || security.status === "rejected") {
          setFailed(true)
          return
        }
        const missed: string[] = []
        if (invitations.status === "rejected") missed.push("invitations")
        if (retention.status === "rejected") missed.push("data retention")
        if (data.status === "rejected") missed.push("data and AI")
        setMissing(missed)
        const m = members.value
        const inv = invitations.status === "fulfilled" ? invitations.value : []
        const s = security.value
        setInput({
          activeMembers: m.filter((one) => one.status === "active").length,
          suspendedMembers: m.filter((one) => one.status === "suspended").length,
          pendingInvitations: inv.filter((one) => one.status === "pending").length,
          expiredInvitations: inv.filter((one) => one.status === "expired").length,
          mfaRequired: s.mfa_required,
          membersWithoutMfa: s.members_without_mfa,
          scopeApproval: s.requires_scope_approval,
          securityManagers: s.security_managers,
          sso: { connected: s.sso.connected, emailDomain: s.sso.email_domain, testedAt: s.sso.tested_at },
          retention:
            retention.status === "fulfilled"
              ? {
                  usingDefaults: retention.value.using_defaults,
                  changedBy: retention.value.changed_by,
                  evidenceDays: retention.value.evidence.days,
                  campaignDays: retention.value.campaign.days,
                  reportDays: retention.value.reports.days,
                  lastRunFailures: retention.value.last_run?.failures ?? 0,
                  lastRunPostponed: retention.value.last_run?.postponed ?? 0,
                }
              : null,
          data:
            data.status === "fulfilled"
              ? { localOnly: data.value.local_models_only, externalTasks: data.value.tasks.filter((task) => task.deployment === "external").length }
              : null,
        })
        setFailed(false)
      },
    )
    return () => {
      alive = false
    }
  }, [canManage, attempt])

  if (canManage === false) {
    return (
      <EmptyState
        title="Only Organization Administrators open Administration"
        description="Ask an Organization Administrator."
      />
    )
  }

  const items = input ? governanceChecklist(input) : []
  const open = needsAttention(items)

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <AdminNav />
      <div className="min-w-0 flex-1 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Where the setup of {organization?.name} stands. Each line is read from the current settings, and its button opens the page that changes it.
          </p>
        </div>

        {failed && (
          <Alert variant="destructive" role="alert">
            <AlertDescription className="flex items-center justify-between gap-4">
              The organization&apos;s settings could not be read, so nothing is shown as set up.
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {missing.length > 0 && (
          <Alert role="status">
            <Ban aria-hidden="true" />
            <AlertDescription>Not shown, because it could not be read: {missing.join(", ")}.</AlertDescription>
          </Alert>
        )}

        {!input && !failed && (
          <div className="space-y-2" role="status" aria-label="Loading the overview">
            <Skeleton className="h-16 w-full max-w-3xl" />
            <Skeleton className="h-16 w-full max-w-3xl" />
            <Skeleton className="h-16 w-full max-w-3xl" />
          </div>
        )}

        {input && (
          <>
            <p role="status" className="max-w-3xl text-sm">
              {open.length === 0
                ? "Nothing needs attention right now."
                : `${open.length} ${open.length === 1 ? "thing needs" : "things need"} attention: ${open.map((one) => one.title.toLowerCase()).join(", ")}.`}
            </p>
            <ol className="max-w-3xl divide-y rounded-[10px] border bg-card">
              {items.map((item) => {
                const look = LOOK[item.state]
                const Icon = look.icon
                return (
                  <li key={item.id} data-state={item.state} className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                        <Icon className={cn("size-4 shrink-0", look.tone)} aria-hidden="true" />
                        {item.title}
                        <span className={cn("text-xs font-normal", look.tone)}>{look.word}</span>
                      </p>
                      <p className="mt-1 text-[13px] text-text-secondary">{item.detail}</p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="h-8 shrink-0">
                      <Link href={item.href}>{item.action}</Link>
                    </Button>
                  </li>
                )
              })}
            </ol>
            <section aria-labelledby="audit-views" className="max-w-3xl rounded-[10px] border bg-card p-4">
              <h2 id="audit-views" className="text-[15px] font-semibold">
                Recent changes in the audit log
              </h2>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                <li>
                  <Link className="text-link hover:underline" href="/audit-log?period=24h">
                    Everything in the last 24 hours
                  </Link>
                </li>
                <li>
                  <Link className="text-link hover:underline" href="/audit-log?group=members">
                    Members and roles
                  </Link>
                </li>
                <li>
                  <Link className="text-link hover:underline" href="/audit-log?group=organization">
                    Organization settings
                  </Link>
                </li>
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
