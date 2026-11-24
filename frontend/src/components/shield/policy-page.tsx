"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Clock, Info, ShieldOff, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { DeployDialog } from "@/components/shield/deploy-dialog"
import { RollbackDialog } from "@/components/shield/rollback-dialog"
import { RulesDialog } from "@/components/shield/rules-dialog"
import { GLASS_SURFACE } from "@/components/sentra/glass-card"
import { type Step, StepJourney } from "@/components/sentra/step-journey"
import { TargetTabs } from "@/components/targets/target-tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useCan } from "@/lib/permissions"
import { POSITION_PHRASE, type PolicyPage as Page, type PolicyVersion, STATUS_IS_A_PROBLEM, getPolicy, sinceNow } from "@/lib/shield"
import { formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

/** The remediations a version carries, in the words the other M8 pages use. */
function Remediations({ version }: { version: PolicyVersion }) {
  if (version.remediations.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <ul className="space-y-0.5">
      {version.remediations.map((one) => (
        <li key={`${one.finding}-${one.version}`}>
          <Link
            href={`/remediation/${one.finding}`}
            className="inline-flex min-h-6 items-center underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {one.finding}
          </Link>
          <span className="text-muted-foreground"> · version {one.version}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Screen 49 (UC-8.4, UC-8.8): the Shield Policy of one target — the gateway in its traffic, the
 * version it enforces with the rules and remediations behind it, every version it has had, and
 * the way back to an earlier one.
 */
export function PolicyPage({ id }: { id: string }) {
  const canManage = useCan("manage_shield")
  const canRollBack = useCan("roll_back_shield_policies")
  const [page, setPage] = useState<Page | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [rules, setRules] = useState<PolicyVersion | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [rollingBackTo, setRollingBackTo] = useState<number | null>(null)

  usePageCrumbs([{ label: page?.target_name ?? "Target", href: `/targets/${id}` }, { label: "Sentra Shield" }])

  useEffect(() => {
    const controller = new AbortController()
    getPolicy(id, controller.signal)
      .then((found) => {
        setPage(found)
        setError(false)
      })
      .catch((failed) => {
        if (controller.signal.aborted) return
        if ((failed as { status?: number }).status === 404) setMissing(true)
        else setError(true)
      })
    return () => controller.abort()
  }, [id, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  if (missing) {
    return (
      <EmptyState
        title="Target not found"
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/shield">Back to Sentra Shield</Link>
          </Button>
        }
      />
    )
  }
  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription className="flex items-center justify-between gap-4">
          The Shield Policy could not be loaded.
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (!page) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the Shield Policy">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const { gateway, active, waiting } = page
  const failed = page.versions.find((one) => one.state === "failed")
  const scheduled = page.versions.find((one) => one.state === "scheduled")
  const behind = gateway && active && gateway.policy_version !== active.version && gateway.status !== "revoked"

  // How the target comes to be protected, from what this page already knows (UC-8.1, UC-8.4)
  const gatewayProblem = gateway ? STATUS_IS_A_PROBLEM[gateway.status] : false
  const enforcing = Boolean(
    gateway && active && active.source !== "disabled" && gateway.status === "active" && gateway.policy_version === active.version,
  )
  const steps: Step[] = [
    !gateway
      ? {
          id: "gateway",
          title: "Gateway",
          state: canManage ? "current" : "waiting",
          status:
            "No gateway stands in this target's traffic, so approved guardrail, tool and retrieval fixes stay a change inside the application.",
          who: "AI Application Developer",
          action: canManage ? { label: "Connect Sentra Shield", href: `/shield/connect/${page.target_id}` } : null,
        }
      : gatewayProblem
        ? {
            id: "gateway",
            title: "Gateway",
            state: "problem",
            word: gateway.status_label,
            status: "The gateway is not protecting anything now.",
            who: "AI Application Developer",
            action:
              gateway.status !== "revoked"
                ? { label: "Troubleshoot", href: `/shield/connect/${page.target_id}?step=3` }
                : canManage
                  ? { label: "Connect again", href: `/shield/connect/${page.target_id}` }
                  : null,
          }
        : {
            id: "gateway",
            title: "Gateway",
            state: "done",
            status: `${gateway.status_label} · ${POSITION_PHRASE[gateway.position]} · last contact ${sinceNow(gateway.last_contact_at)}.`,
          },
    page.deployable.length > 0
      ? {
          id: "fixes",
          title: "Approved fixes",
          state: "current",
          word: "Ready",
          status: `${page.deployable.length} ${page.deployable.length === 1 ? "remediation" : "remediations"} a person approved ${page.deployable.length === 1 ? "is" : "are"} not in the policy yet.`,
          who: "AI Application Developer",
          action:
            canManage && gateway?.status === "active"
              ? { label: "Deploy approved fixes", onClick: () => setDeploying(true) }
              : { label: "See the remediations", href: "/remediation" },
        }
      : active
        ? { id: "fixes", title: "Approved fixes", state: "done", status: "Every approved fix that a gateway can carry is in the policy." }
        : {
            id: "fixes",
            title: "Approved fixes",
            state: "upcoming",
            status: "A fix is approved by a person before it can go into a policy.",
            action: { label: "Open the remediations", href: "/remediation" },
          },
    failed
      ? {
          id: "deploy",
          title: "Deployed",
          state: "problem",
          status: `Version ${failed.version} was not activated${failed.failure_reason ? `: ${failed.failure_reason}` : "."}`,
          who: "AI Application Developer",
        }
      : waiting
        ? {
            id: "deploy",
            title: "Deployed",
            state: "current",
            working: true,
            word: "On its way",
            status: `Version ${waiting.version} (${waiting.rule_count} rules) is on its way to the gateway.`,
          }
        : scheduled
          ? {
              id: "deploy",
              title: "Deployed",
              state: "waiting",
              status: `Version ${scheduled.version} waits for its maintenance window${scheduled.deploy_at ? ` on ${formatDateTime(scheduled.deploy_at)}` : ""}.`,
            }
          : active
            ? {
                id: "deploy",
                title: "Deployed",
                state: "done",
                status: `Version ${active.version} ${active.confirmed_at ? `active since ${formatDateTime(active.confirmed_at)}` : `deployed ${formatDateTime(active.created_at)}`}${active.deployed_by ? ` by ${active.deployed_by}` : ""}.`,
              }
            : { id: "deploy", title: "Deployed", state: "upcoming", status: "Nothing is deployed yet." },
    enforcing
      ? {
          id: "enforce",
          title: "Enforcing",
          state: "done",
          status: `The gateway enforces version ${active?.version}: ${gateway?.requests_blocked.toLocaleString("en-GB")} requests stopped so far.`,
          action: active ? { label: "View the rules", onClick: () => setRules(active) } : null,
        }
      : behind
        ? {
            id: "enforce",
            title: "Enforcing",
            state: "current",
            status: `The gateway last reported version ${gateway?.policy_version}; it takes version ${active?.version} at its next report.`,
          }
        : {
            id: "enforce",
            title: "Enforcing",
            state: "upcoming",
            status:
              active?.source === "disabled"
                ? "The policy is switched off: traffic passes unchanged."
                : "Begins when the gateway confirms the policy.",
          },
  ]
  const firstOpen = steps.find((step) => step.state !== "done" && step.state !== "upcoming") ?? steps[steps.length - 1]

  return (
    <div className="pb-24">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{page.target_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sentra Shield</p>
      </div>

      <TargetTabs targetId={page.target_id} active="shield" />

      <StepJourney
        title="How this target is protected"
        titleId="shield-journey-heading"
        fallbackId={firstOpen.id}
        steps={steps}
        summary={firstOpen.state === "done" ? "The Shield is enforcing the approved policy." : `Next: ${firstOpen.title.toLowerCase()}.`}
      />

      {/* The gateway in the traffic (UC-8.1) */}
      <section aria-labelledby="gateway" className={`rounded-2xl border p-4 ${GLASS_SURFACE}`}>
        <h2 id="gateway" className="text-[15px] font-semibold">
          Gateway
        </h2>
        {gateway ? (
          <>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 font-medium",
                  STATUS_IS_A_PROBLEM[gateway.status] ? "text-warning" : "text-text-secondary",
                )}
              >
                {STATUS_IS_A_PROBLEM[gateway.status] && <TriangleAlert className="size-3.5" aria-hidden="true" />}
                {gateway.status_label}
              </span>
              <span className="text-muted-foreground">·</span>
              <span>{POSITION_PHRASE[gateway.position]}</span>
              <span className="text-muted-foreground">·</span>
              <span>version {gateway.gateway_version ?? "unknown"}</span>
              <span className="text-muted-foreground">·</span>
              <span>last contact {sinceNow(gateway.last_contact_at)}</span>
              {gateway.added_latency_ms !== null && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span>adds {gateway.added_latency_ms} ms (median)</span>
                </>
              )}
            </p>
            <dl className="mt-3 grid grid-cols-3 divide-x divide-foreground/10 rounded-xl bg-white/70 py-2 text-center dark:bg-white/5">
              {[
                ["Through it", gateway.requests_seen],
                ["Stopped by its policy", gateway.requests_blocked],
                ["Changed", gateway.requests_changed],
              ].map(([label, value]) => (
                <div key={String(label)} className="px-2">
                  <dd className="tabular text-xl leading-7 font-semibold">{Number(value).toLocaleString("en-GB")}</dd>
                  <dt className="text-xs text-foreground/65">{label}</dt>
                </div>
              ))}
            </dl>
            {Object.keys(gateway.retrieval_sightings).length > 0 && (
              <p className="mt-2 text-[13px] text-muted-foreground">
                Watched sources seen:{" "}
                {Object.entries(gateway.retrieval_sightings)
                  .map(([source, count]) => `${source} (${count})`)
                  .join(", ")}
              </p>
            )}
            {STATUS_IS_A_PROBLEM[gateway.status] && gateway.status !== "revoked" && (
              <Button asChild variant="outline" size="sm" className="mt-3 h-8">
                <Link href={`/shield/connect/${page.target_id}?step=3`}>Troubleshoot</Link>
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="mt-1.5 flex items-start gap-2 text-sm">
              <ShieldOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              No gateway stands in this target&apos;s traffic, so approved guardrail, tool and retrieval fixes stay a change inside the
              application.
            </p>
            {canManage && (
              <Button asChild variant="outline" size="sm" className="mt-3 h-8">
                <Link href={`/shield/connect/${page.target_id}`}>Connect Sentra Shield</Link>
              </Button>
            )}
          </>
        )}
      </section>

      {/* What is on its way, and what never arrived (UC-8.4, 1a and 4a1) */}
      {waiting && (
        <p className="mt-4 flex items-start gap-2 rounded-[10px] border bg-card p-4 text-sm" aria-live="polite">
          <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            Version {waiting.version} ({waiting.rule_count} rules) is on its way to the gateway. It becomes active when the gateway confirms
            that it is enforcing it.
          </span>
        </p>
      )}
      {scheduled && (
        <p className="mt-4 flex items-start gap-2 rounded-[10px] border bg-card p-4 text-sm">
          <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            Version {scheduled.version} waits for its maintenance window
            {scheduled.deploy_at ? ` on ${formatDateTime(scheduled.deploy_at)}` : ""}.
          </span>
        </p>
      )}
      {failed?.failure_reason && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-[10px] border border-warning/40 bg-warning/5 p-4 text-sm text-warning"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Version {failed.version} was not activated: {failed.failure_reason} Version {active?.version ?? "—"} is still what the gateway
            enforces.
          </span>
        </p>
      )}
      {behind && (
        <p className="mt-4 flex items-start gap-2 rounded-[10px] border bg-card p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            The gateway last reported version {gateway?.policy_version}; it takes version {active?.version} at its next report.
          </span>
        </p>
      )}

      {/* The active version (UC-8.4 step 5) */}
      <section aria-labelledby="active-policy" className={`mt-4 min-w-0 rounded-2xl border p-4 ${GLASS_SURFACE}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="active-policy" className="text-[15px] font-semibold">
              {active
                ? `Shield Policy v${active.version} — ${active.source === "disabled" ? "the policy is switched off" : "active"}`
                : "No Shield Policy yet"}
            </h2>
            {active && (
              <p className="mt-1 text-[13px] text-muted-foreground">
                {active.confirmed_at
                  ? `active since ${formatDateTime(active.confirmed_at)}`
                  : `deployed ${formatDateTime(active.created_at)}`}
                {active.deployed_by ? ` · by ${active.deployed_by}` : ""}
                {active.approved_by ? ` · approved by ${active.approved_by}` : ""}
              </p>
            )}
          </div>
          {active && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => setRules(active)}>
              View rules
            </Button>
          )}
        </div>

        {active ? (
          <>
            {active.source === "disabled" && (
              <p className="mt-3 text-[13px] text-text-secondary">Traffic passes unchanged. Deploy an approved fix to protect it.</p>
            )}
            {active.reason && (
              <p className="mt-3 text-[13px] text-text-secondary">
                Reason given: &ldquo;{active.reason}&rdquo;
                {active.rolled_back_from ? ` (it replaced version ${active.rolled_back_from})` : ""}
              </p>
            )}
            {active.remediations.length > 0 && (
              <div className="mt-3">
                <h3 className="text-[13px] font-semibold">Included remediations</h3>
                <ul className="mt-1 space-y-0.5 text-[13px]">
                  {active.remediations.map((one) => (
                    <li key={`${one.finding}-${one.version}`}>
                      <Link
                        href={`/remediation/${one.finding}`}
                        className="inline-flex min-h-6 items-center font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {one.finding}
                      </Link>
                      {one.finding_title ? ` ${one.finding_title}` : ""}
                      <span className="text-muted-foreground">
                        {" "}
                        · proposal version {one.version} · {one.fixes.length} {one.fixes.length === 1 ? "fix" : "fixes"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
              {active.rule_counts.map((count) => (
                <div key={count.label} className="flex gap-1.5">
                  <dt className="text-muted-foreground">{count.label}</dt>
                  <dd className="font-medium">{count.count}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="mt-2 text-[13px] text-text-secondary">Nothing enforced yet.</p>
        )}
      </section>

      {/* UC-8.4 step 1: what could go in next */}
      {page.deployable.length > 0 && (
        <section aria-labelledby="deployable" className="mt-4 min-w-0 rounded-[10px] border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="deployable" className="text-[15px] font-semibold">
                Approved fixes not in the policy yet
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {page.deployable.length} {page.deployable.length === 1 ? "remediation" : "remediations"} a person approved.
              </p>
            </div>
            {canManage && gateway?.status === "active" && (
              <Button className="h-9 hover:bg-primary-hover" onClick={() => setDeploying(true)}>
                Deploy approved fixes
              </Button>
            )}
          </div>
          <ul className="mt-3 space-y-2 text-[13px]">
            {page.deployable.map((row) => (
              <li key={row.finding}>
                <Link
                  href={`/remediation/${row.finding}`}
                  className="inline-flex min-h-6 items-center font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {row.finding}
                </Link>{" "}
                {row.finding_title}
                <span className="text-muted-foreground"> · version {row.version}</span>
                <ul className="mt-1 ml-4 list-disc space-y-0.5 text-muted-foreground">
                  {row.fixes.map((fix) => (
                    <li key={fix.fix}>
                      {fix.title} —{" "}
                      {fix.needs_terms
                        ? `${fix.becomes?.toLowerCase() ?? "a rule"}, once you write the terms it matches`
                        : fix.becomes
                          ? `goes in as ${fix.becomes.toLowerCase()}`
                          : fix.reason}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Every version it has had (FR-8.3: none of them is ever changed) */}
      {page.versions.length > 0 && (
        <section aria-labelledby="history" className="mt-4 min-w-0 rounded-[10px] border bg-card">
          <div className="border-b p-3">
            <h2 id="history" className="text-[15px] font-semibold">
              Version history
            </h2>
          </div>
          <Table
            container={{
              tabIndex: 0,
              role: "group",
              "aria-label": "Shield Policy versions",
              className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            }}
          >
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead scope="col" className="text-xs">
                  Version
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  State
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Remediations
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Deployed
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Approved by
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.versions.map((one) => (
                <TableRow key={one.version}>
                  <TableCell className="text-[13px] font-medium">
                    v{one.version}
                    {one.source !== "remediation" && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {one.source === "rollback" ? `rollback to v${one.based_on_version}` : "policy switched off"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[14rem] text-[13px] whitespace-normal">
                    <span
                      className={cn(
                        "font-medium",
                        one.state === "active" && "text-success",
                        (one.state === "failed" || one.state === "rolled_back") && "text-warning",
                      )}
                    >
                      {one.state_label}
                    </span>
                    {one.rolled_back_reason && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">reason: {one.rolled_back_reason}</span>
                    )}
                    {one.failure_reason && <span className="mt-0.5 block text-xs text-muted-foreground">{one.failure_reason}</span>}
                    {one.reason && one.state !== "rolled_back" && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">reason: {one.reason}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[12rem] text-[13px] whitespace-normal">
                    <Remediations version={one} />
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {formatDateTime(one.confirmed_at ?? one.created_at)}
                    {one.deployed_by && <span className="block text-xs text-muted-foreground">by {one.deployed_by}</span>}
                  </TableCell>
                  <TableCell className="text-[13px]">{one.approved_by ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="space-x-2 text-right whitespace-nowrap">
                    <Button variant="outline" size="sm" className="h-8" onClick={() => setRules(one)}>
                      View rules
                      <span className="sr-only"> of version {one.version}</span>
                    </Button>
                    {canRollBack &&
                      active &&
                      one.version !== active.version &&
                      one.rule_count > 0 &&
                      (one.state === "superseded" || one.state === "rolled_back") && (
                        <Button variant="outline" size="sm" className="h-8" onClick={() => setRollingBackTo(one.version)}>
                          Roll back to v{one.version}
                        </Button>
                      )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t p-3 text-[13px] text-muted-foreground">
            Versions are never changed. Each deploy or rollback writes a new one.
          </p>
        </section>
      )}

      {/* UC-8.8, 2a */}
      {canRollBack && active && active.source !== "disabled" && (
        <div className="mt-6">
          <Button
            variant="ghost"
            className="h-9 px-0 text-destructive hover:bg-transparent hover:text-destructive"
            onClick={() => setRollingBackTo(0)}
          >
            Disable Shield Policy
          </Button>
          <p className="text-[13px] text-muted-foreground">The gateway will forward all traffic unchanged.</p>
        </div>
      )}

      <RulesDialog version={rules} open={rules !== null} onClose={() => setRules(null)} />
      <DeployDialog
        key={deploying ? "deploy-open" : "deploy-closed"}
        targetId={page.target_id}
        deployable={page.deployable}
        open={deploying}
        onClose={() => setDeploying(false)}
        onDone={(result) => {
          setDeploying(false)
          toast.success(`Version ${result.policy.version} (${result.policy.rule_count} rules) is on its way to the gateway.`, {
            description:
              result.open_in_application.length > 0
                ? `${result.open_in_application.length} fix(es) stay a change in the application.`
                : undefined,
          })
          reload()
        }}
      />
      <RollbackDialog
        key={`rollback-${rollingBackTo ?? "closed"}`}
        targetId={page.target_id}
        toVersion={rollingBackTo ?? 0}
        open={rollingBackTo !== null}
        onClose={() => setRollingBackTo(null)}
        onDone={(result) => {
          setRollingBackTo(null)
          toast.success(
            result.consequences.disables
              ? "The Shield Policy is switched off."
              : `Rolled back to version ${result.consequences.to_version}.`,
            {
              description: result.consequences.gateway_reachable
                ? `The gateway takes version ${result.policy.version} within ${result.consequences.window_seconds} seconds.`
                : "The gateway isn't reporting; it applies the change as soon as it reconnects.",
            },
          )
          reload()
        }}
      />
    </div>
  )
}
