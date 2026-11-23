"use client"

import { useEffect, useState } from "react"
import {
  BadgeCheck,
  CircleCheck,
  CircleHelp,
  ClipboardCheck,
  FilePenLine,
  Gauge,
  Inbox,
  KeyRound,
  Mail,
  PauseCircle,
  ShieldAlert,
  Siren,
  UserRound,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { OperationalNotice } from "@/components/risk/operational-notice"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { getAttention, type Attention, type AttentionItem, type AttentionKey } from "@/lib/risk"
import { cn } from "@/lib/utils"

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** How each thing is said, what it looks like, and where it opens: the one thing when there is
 * just one, otherwise the page with the same count. */
const WORDING: Record<AttentionKey, { icon: LucideIcon; text: (item: AttentionItem) => string; href?: (item: AttentionItem) => string }> = {
  paused_runs: {
    icon: PauseCircle,
    text: ({ count }) => plural(count, "campaign run is paused", "campaign runs are paused"),
    href: ({ one }) => (one.campaign ? `/campaigns/${one.campaign}/runs/${one.number}` : "/campaigns"),
  },
  new_findings: {
    icon: Inbox,
    text: ({ count }) => plural(count, "new finding to triage", "new findings to triage"),
    href: () => "/findings?view=open&status=new",
  },
  requires_confirmation: {
    icon: CircleHelp,
    text: ({ count }) => plural(count, "finding requires confirmation", "findings require confirmation"),
    href: () => "/findings?view=requires_confirmation",
  },
  awaiting_my_approval: {
    icon: BadgeCheck,
    text: ({ count }) => plural(count, "remediation awaits your approval", "remediations await your approval"),
    href: () => "/remediation?show=approval",
  },
  threat_model_drafts: {
    icon: FilePenLine,
    text: ({ count }) => plural(count, "threat model draft to review", "threat model drafts to review"),
    href: ({ one }) => (one.target_id ? `/targets/${one.target_id}/threat-model` : "/threat-models"),
  },
  assigned_to_me: {
    icon: UserRound,
    text: ({ count }) => plural(count, "open finding assigned to you", "open findings assigned to you"),
    href: () => "/findings?view=assigned",
  },
  open_changes: {
    icon: Wrench,
    text: ({ count }) => plural(count, "application change to make", "application changes to make"),
    href: () => "/remediation/changes",
  },
  unverified_targets: {
    icon: ShieldAlert,
    text: ({ count }) => plural(count, "target to verify before it can be tested", "targets to verify before they can be tested"),
    href: ({ one }) => (one.target_id ? `/targets/${one.target_id}/verify` : "/targets"),
  },
  gateways_not_reporting: {
    icon: WifiOff,
    text: ({ count }) => plural(count, "Sentra Shield gateway isn't reporting", "Sentra Shield gateways aren't reporting"),
    href: ({ one }) => (one.target_id ? `/targets/${one.target_id}/shield` : "/shield"),
  },
  scopes_to_approve: {
    icon: ClipboardCheck,
    text: ({ count }) => plural(count, "campaign scope to approve", "campaign scopes to approve"),
    href: ({ one }) => (one.code ? `/campaigns/${one.code}/approval` : "/campaigns"),
  },
  critical_findings: {
    icon: Siren,
    text: ({ count }) => plural(count, "critical finding is open", "critical findings are open"),
    href: () => "/findings?view=open&severity=critical",
  },
  // A monthly limit has no page of its own for these roles: the line says when it resets.
  usage_limit: {
    icon: Gauge,
    text: ({ detail }) =>
      (detail.percent ?? 0) >= 100
        ? `This month's ${detail.label} limit is reached: no new run starts before ${detail.resets}`
        : `of this month's ${detail.label} limit is used · it resets on ${detail.resets}`,
  },
  pending_invitations: {
    icon: Mail,
    text: ({ count, detail }) =>
      `${plural(count, "invitation isn't accepted yet", "invitations aren't accepted yet")}${detail.expired ? ` · ${detail.expired} expired` : ""}`,
    href: () => "/admin/members",
  },
  expiring_api_keys: {
    icon: KeyRound,
    text: ({ count, detail }) =>
      plural(count, `API key expires within ${detail.within_days} days`, `API keys expire within ${detail.within_days} days`),
    href: () => "/integrations/api-keys",
  },
}

/** What the notices of the second group are: the state of the organization's operations, not work on findings. */
const OPERATIONS: AttentionKey[] = ["gateways_not_reporting", "usage_limit", "pending_invitations", "expiring_api_keys"]

function Item({ item }: { item: AttentionItem }) {
  const wording = WORDING[item.key]
  if (!wording) return null
  // A usage limit is a share, not a count of things
  const figure = item.key === "usage_limit" ? ((item.detail.percent ?? 0) >= 100 ? null : `${item.detail.percent} %`) : item.count
  // A gateway that isn't reporting, and a limit that is reached, are the problems of this list
  const problem = item.key === "gateways_not_reporting" || (item.key === "usage_limit" && (item.detail.percent ?? 0) >= 100)
  return (
    <li>
      <OperationalNotice icon={wording.icon} href={wording.href?.(item)} tone={problem ? "warning" : "normal"}>
        {figure !== null && <span className="tabular font-semibold">{figure} </span>}
        {wording.text(item)}
      </OperationalNotice>
    </li>
  )
}

/**
 * "Needs your attention" (Screen 42; UC-7.3): what this person can act on now, at most five
 * things, each one only when it is real and above zero, each count the same as on the page it
 * opens. It is the person's work, so it covers the whole organization whatever the filters say.
 */
export function NeedsAttention({ filtered, className }: { filtered: boolean; className?: string }) {
  const [data, setData] = useState<Attention | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getAttention(controller.signal)
      .then((found) => {
        setData(found)
        setFailed(null)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        // The API's own words when it gave any, such as "wait a minute" after too many requests
        setFailed(error instanceof ApiError ? error.message : "This list could not be loaded.")
      })
    return () => controller.abort()
  }, [attempt])

  const work = data?.items.filter((item) => !OPERATIONS.includes(item.key)) ?? []
  const operations = data?.items.filter((item) => OPERATIONS.includes(item.key)) ?? []
  const group = (label: string, items: AttentionItem[]) =>
    items.length > 0 && (
      <div>
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h3>
        <ul className="mt-1.5 space-y-1.5">
          {items.map((item) => (
            <Item key={item.key} item={item} />
          ))}
        </ul>
      </div>
    )

  return (
    <section aria-labelledby="needs-attention" className={cn("rounded-[10px] border bg-card px-4 py-3", className)}>
      <h2 id="needs-attention" className="text-[15px] font-semibold">
        Needs your attention
        {filtered && <span className="block text-[13px] font-normal text-muted-foreground">in the whole organization, whatever the filters say</span>}
      </h2>
      {failed ? (
        <p className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground" role="alert">
          {failed}
          <Button variant="outline" size="sm" className="h-8" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </p>
      ) : !data ? (
        <div className="mt-2 space-y-2" role="status" aria-label="Loading what needs your attention">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-9 w-full" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <p className="mt-2 flex min-h-10 items-center gap-2 text-[13px] text-text-secondary">
          <CircleCheck className="size-4 text-success" aria-hidden="true" />
          Nothing waits for you right now.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {group("Work waiting for you", work)}
          {group("Operations", operations)}
          {data.more > 0 && (
            <p className="px-1 text-[13px] text-muted-foreground">
              and {data.more} more {plural(data.more, "thing", "things")}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
