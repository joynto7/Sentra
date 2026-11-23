"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
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

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { getAttention, type Attention, type AttentionItem, type AttentionKey } from "@/lib/risk"

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

function Item({ item }: { item: AttentionItem }) {
  const wording = WORDING[item.key]
  if (!wording) return null
  const Icon = wording.icon
  // A usage limit is a share, not a count of things
  const figure = item.key === "usage_limit" ? ((item.detail.percent ?? 0) >= 100 ? null : `${item.detail.percent} %`) : item.count
  const body = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>
        {figure !== null && <span className="tabular font-semibold">{figure} </span>}
        {wording.text(item)}
      </span>
    </>
  )
  const shape = "flex min-h-9 items-center gap-2 rounded-[7px] border px-3 py-1 text-[13px]"
  return (
    <li>
      {wording.href ? (
        <Link
          href={wording.href(item)}
          className={`${shape} group bg-card hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
        >
          {body}
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
        </Link>
      ) : (
        <p className={`${shape} bg-muted/40`}>{body}</p>
      )}
    </li>
  )
}

/**
 * "Needs your attention" (Screen 42; UC-7.3): what this person can act on now, at most five
 * things, each one only when it is real and above zero, each count the same as on the page it
 * opens. It is the person's work, so it covers the whole organization whatever the filters say.
 */
export function NeedsAttention({ filtered }: { filtered: boolean }) {
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

  return (
    <section aria-labelledby="needs-attention" className="rounded-[10px] border bg-card px-4 py-3">
      <h2 id="needs-attention" className="text-[15px] font-semibold">
        Needs your attention
        {filtered && <span className="ml-2 text-[13px] font-normal text-muted-foreground">in the whole organization</span>}
      </h2>
      {failed ? (
        <p className="mt-2 flex items-center gap-3 text-[13px] text-muted-foreground" role="alert">
          {failed}
          <Button variant="outline" size="sm" className="h-8" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </p>
      ) : !data ? (
        <div className="mt-2 flex flex-wrap gap-2" role="status" aria-label="Loading what needs your attention">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-9 w-56" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <p className="mt-2 flex min-h-10 items-center gap-2 text-[13px] text-text-secondary">
          <CircleCheck className="size-4 text-success" aria-hidden="true" />
          Nothing waits for you right now.
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap items-center gap-2">
          {data.items.map((item) => (
            <Item key={item.key} item={item} />
          ))}
          {data.more > 0 && (
            <li className="px-1 text-[13px] text-muted-foreground">
              and {data.more} more {plural(data.more, "thing", "things")}
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
