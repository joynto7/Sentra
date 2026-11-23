"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { FindingHeader } from "@/components/findings/finding-header"
import { FindingTabs } from "@/components/findings/finding-tabs"
import { PageHeader } from "@/components/layout/page-header"
import { ApprovalPanel } from "@/components/remediation/approval-panel"
import { RetestChip, StatusChip } from "@/components/remediation/badges"
import { CommentThread } from "@/components/remediation/comment-thread"
import { FixCard } from "@/components/remediation/fix-card"
import { ProposalEditor } from "@/components/remediation/fix-editor"
import { VersionCompare } from "@/components/remediation/version-compare"
import { FilterSelect } from "@/components/sentra/filter-select"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { AiGeneratedLabel } from "@/components/threat-models/badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { type FindingDetail, getFinding } from "@/lib/findings"
import { useCan } from "@/lib/permissions"
import {
  type RemediationPage as Page,
  getRemediation,
  getRemediationJob,
  requestRemediation,
} from "@/lib/remediation"
import { formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

const POLL = 2000

/**
 * What became of the version after it was approved (UC-8.5 and UC-8.6), under the fixes it
 * recommends: the changes the application's own developers still have to make, with the sentence
 * that says what the proposal is waiting for, and every retest with what it decided. The work
 * itself happens where it belongs — Screen 50 marks a change, Screen 51 holds the comparison.
 */
function Verification({ code, page }: { code: string; page: Page }) {
  if (page.changes.length === 0 && page.retests.length === 0) return null
  const open = page.changes.filter((one) => one.status === "open")
  return (
    <section aria-labelledby="verification" className="rounded-[10px] border bg-card p-4">
      <h2 id="verification" className="text-[15px] font-semibold">
        Verification
      </h2>

      {page.changes.length > 0 && (
        <>
          <h3 className="mt-3 text-[13px] font-medium text-muted-foreground">
            Changes inside the application ({page.changes.length})
          </h3>
          <ul className="mt-2 space-y-2">
            {page.changes.map((change) => (
              <li
                key={change.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-[7px] border bg-muted/20 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{change.title}</p>
                  {change.status === "implemented" ? (
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {change.note}
                      {change.implemented_by ? ` — ${change.implemented_by}` : ""}
                      {change.implemented_at ? `, ${formatDateTime(change.implemented_at)}` : ""}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      Waiting for the application&apos;s developer.
                    </p>
                  )}
                  {change.link && (
                    <a
                      href={change.link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-0.5 inline-block py-0.5 text-[13px] text-link hover:underline"
                    >
                      The code change
                    </a>
                  )}
                </div>
                <span
                  className={cn(
                    "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap",
                    change.status === "implemented"
                      ? "border-confirm/50 text-confirm"
                      : "border-warning/60 text-warning",
                  )}
                >
                  {change.status === "implemented" ? "Implemented" : "Open"}
                </span>
              </li>
            ))}
          </ul>
          {open.length > 0 && (
            <Button asChild variant="link" className="mt-1 h-7 p-0 text-[13px]">
              <Link href="/remediation/changes">
                Mark {open.length === 1 ? "it" : "them"} as implemented
              </Link>
            </Button>
          )}
        </>
      )}

      {page.retests.length > 0 && (
        <>
          <h3 className="mt-4 text-[13px] font-medium text-muted-foreground">
            Retests ({page.retests.length})
          </h3>
          <ul className="mt-2 space-y-2">
            {page.retests.map((retest) => (
              <li key={retest.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px]">
                  Retest {retest.number} · version {retest.version} ·{" "}
                  <span className="text-muted-foreground">
                    {formatDateTime(retest.finished_at ?? retest.started_at)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <RetestChip retest={retest} />
                  <Link
                    href={`/remediation/${code}/retest?number=${retest.number}`}
                    className="py-1 text-[13px] text-link hover:underline"
                  >
                    {retest.running ? "Follow it" : "Before and after"}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/**
 * Screen 46: one version of the proposal for a finding (UC-8.2 and UC-8.3). It shows the root
 * cause, the fixes with their kind and where each takes effect, and which version is being read;
 * beside them the approval, which is the only way anything here takes effect (NFR-9.3). A
 * developer adapts the proposal as the next version (UC-8.3 steps 2-3), and an analyst or a
 * manager approves or rejects it — never the person who adapted it (4a). Under the fixes stands
 * what became of the approved version: the changes the application still needs (UC-8.5) and the
 * retests that judged it (UC-8.6).
 */
export function RemediationView({ code, inFinding = false }: { code: string; inFinding?: boolean }) {
  const canRequest = useCan("request_remediations")
  const [version, setVersion] = useState<number | null>(null)
  const [data, setData] = useState<Page | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(false)
  const [comparing, setComparing] = useState(false)

  usePageCrumbs(
    inFinding ? [{ label: code, href: `/findings/${code}` }, { label: "Remediation" }] : [{ label: code }],
  )

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  // As a tab of the finding, the page has the finding's own head (Screens 39-40). Without it — it
  // couldn't be read — the remediation's head below still says which finding this is.
  const [finding, setFinding] = useState<FindingDetail | null>(null)
  useEffect(() => {
    if (!inFinding) return
    const controller = new AbortController()
    getFinding(code, controller.signal)
      .then(setFinding)
      .catch(() => undefined)
    return () => controller.abort()
  }, [code, inFinding, attempt])

  useEffect(() => {
    const controller = new AbortController()
    getRemediation(code, version ?? undefined, controller.signal)
      .then((found) => {
        setData(found)
        setError(null)
      })
      .catch((problem) => {
        if (controller.signal.aborted) return
        setError(
          problem instanceof ApiError ? problem.message : "The proposal could not be loaded.",
        )
      })
    return () => controller.abort()
  }, [code, version, attempt])

  // While a worker writes a proposal, the page follows its job until it is done (UC-8.2 step 2).
  const running = data?.job && (data.job.status === "queued" || data.job.status === "running")
  useEffect(() => {
    if (!running || !data?.job) return
    const id = data.job.id
    const timer = setInterval(() => {
      getRemediationJob(code, id)
        .then((job) => {
          if (job.status === "done" || job.status === "failed") {
            setVersion(null)
            setAttempt((n) => n + 1)
          }
        })
        .catch(() => undefined)
    }, POLL)
    return () => clearInterval(timer)
  }, [running, data?.job, code])

  const ask = useCallback(async () => {
    setBusy(true)
    try {
      await requestRemediation(code)
      toast.success("Sentra is writing the proposal.")
      setVersion(null)
      setAttempt((n) => n + 1)
    } catch (problem) {
      toast.error(
        problem instanceof ApiError ? problem.message : "The proposal could not be asked for.",
      )
    } finally {
      setBusy(false)
    }
  }, [code])

  if (error) {
    return (
      <>
        <PageHeader title={code} />
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            {error}
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </>
    )
  }

  if (!data) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the proposal">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const current = data.current
  const askLabel = data.versions.length > 0 ? "Ask for a revision" : "Request remediation"
  const askButton = canRequest && !data.blocker && !editing && data.current !== null && (
    <Button className="h-9 hover:bg-primary-hover" onClick={ask} disabled={busy || Boolean(running)}>
      {running ? "Writing…" : busy ? "Asking…" : askLabel}
    </Button>
  )

  return (
    <>
      {inFinding && finding ? (
        // A tab of the finding: the finding's own head and tabs, as on its other three tabs
        <>
          <FindingHeader
            finding={finding}
            action={askButton}
            crumbs={[{ label: finding.code, href: `/findings/${finding.code}` }, { label: "Remediation" }]}
          />
          <FindingTabs code={finding.code} active="remediation" evidence={finding.evidence_count} />
        </>
      ) : (
        <>
          <PageHeader
            title={`Remediation for ${data.finding.code}`}
            description={data.finding.title}
            action={askButton}
          />

          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <SeverityBadge severity={data.finding.severity} />
            {!inFinding && (
              <>
                <Link href={`/findings/${data.finding.code}`} className="py-1 text-link hover:underline">
                  Open the finding
                </Link>
                <span className="text-muted-foreground">·</span>
              </>
            )}
            <Link
              href={`/targets/${data.finding.target_id}`}
              className="py-1 text-link hover:underline"
            >
              {data.finding.target_name}
            </Link>
            <span className="text-muted-foreground">· {data.finding.component}</span>
          </div>
          {inFinding && <FindingTabs code={data.finding.code} active="remediation" />}
        </>
      )}

      {data.blocker && (
        <Alert role="status" className="mb-4">
          <AlertDescription>{data.blocker}</AlertDescription>
        </Alert>
      )}

      {running && (
        <Alert role="status" className="mb-4">
          <AlertDescription>
            Sentra is writing the proposal. It reads the finding, its evidence and the Target
            Profile, and this page shows the version as soon as it is there.
          </AlertDescription>
        </Alert>
      )}

      {data.job?.status === "failed" && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{data.job.message ?? "The last generation failed."}</AlertDescription>
        </Alert>
      )}

      {!current ? (
        <EmptyState
          title={running ? "Sentra is writing the proposal" : "No proposal yet"}
          description={
            running
              ? "It reads the finding, its evidence and the Target Profile, and the version appears here as soon as it is written."
              : (data.blocker ??
                (canRequest
                  ? "Ask Sentra for a proposal: it reads the finding, its evidence and the Target Profile and recommends how to fix it."
                  : "Sentra writes a proposal when an AI Application Developer or a Security Analyst asks for one. It reads the finding, its evidence and the Target Profile and recommends how to fix it."))
          }
          action={
            canRequest && !data.blocker && !running ? (
              <Button className="h-9 hover:bg-primary-hover" onClick={ask} disabled={busy}>
                {askLabel}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            <section aria-labelledby="version" className="rounded-[10px] border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="version" className="text-[15px] font-semibold">
                    Version {current.version}
                  </h2>
                  <StatusChip status={current.status} />
                  {current.ai_generated && <AiGeneratedLabel note={current.model ?? undefined} />}
                  {current.origin === "revised" && (
                    <span className="text-xs text-muted-foreground">
                      revision of version {current.based_on_version}
                    </span>
                  )}
                  {current.origin === "edited" && (
                    <span className="text-xs text-muted-foreground">
                      adapted from version {current.based_on_version} by{" "}
                      {current.edited_by ?? "a developer"}
                    </span>
                  )}
                </div>
                {data.versions.length > 1 && (
                  <FilterSelect
                    label="Version"
                    value={String(current.version)}
                    onChange={(value) => setVersion(Number(value))}
                    options={data.versions.map((one) => ({
                      value: String(one.version),
                      label: `Version ${one.version}${one.version === data.versions[0].version ? " (newest)" : ""}`,
                    }))}
                    allLabel={null}
                    changed={current.version !== data.versions[0].version}
                  />
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Asked for by {current.requested_by ?? "someone"} on{" "}
                {formatDateTime(current.created_at)}
                {current.dropped > 0 &&
                  ` · ${current.dropped} ${current.dropped === 1 ? "fix was" : "fixes were"} left out because Sentra could not use ${current.dropped === 1 ? "it" : "them"}`}
              </p>
              {current.based_on_version !== null && (
                <Button
                  variant="link"
                  className="mt-1 h-6 p-0 text-[13px]"
                  aria-expanded={comparing}
                  onClick={() => setComparing((on) => !on)}
                >
                  {comparing
                    ? "Hide the comparison"
                    : `Compare with version ${current.based_on_version}`}
                </Button>
              )}
              {comparing && current.based_on_version !== null && (
                <div className="mt-3 rounded-[7px] border bg-muted/30 p-3">
                  <VersionCompare
                    code={code}
                    current={current}
                    earlier={current.based_on_version}
                  />
                </div>
              )}
              <h3 className="mt-4 text-[13px] font-medium text-muted-foreground">Root cause</h3>
              <p className="mt-1 text-sm">{current.root_cause}</p>
              <h3 className="mt-3 text-[13px] font-medium text-muted-foreground">
                What the fixes do
              </h3>
              <p className="mt-1 text-sm">{current.summary}</p>
              {current.mitigation_only && (
                <p className="mt-3 rounded-[7px] border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
                  {current.mitigation_only}
                </p>
              )}
              <p className="mt-3 border-t pt-3 text-[13px] text-muted-foreground">
                {data.in_effect
                  ? data.in_effect
                  : "Nothing this proposal recommends takes effect until a person approves it."}
              </p>
            </section>

            {editing ? (
              <ProposalEditor
                code={code}
                current={current}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false)
                  setVersion(null)
                  reload()
                }}
              />
            ) : (
              <section aria-labelledby="fixes">
                <h2 id="fixes" className="mb-2 text-[15px] font-semibold">
                  Recommended fixes ({current.fixes.length})
                </h2>
                <ol className="space-y-3">
                  {current.fixes.map((fix) => (
                    <FixCard key={fix.position} fix={fix} />
                  ))}
                </ol>
              </section>
            )}

            <Verification code={code} page={data} />

            <CommentThread
              code={code}
              version={current.version}
              comments={data.comments}
              onPosted={reload}
            />
          </div>

          <ApprovalPanel
            code={code}
            page={data}
            current={current}
            onEdit={editing ? undefined : () => setEditing(true)}
            onDone={() => {
              setVersion(null)
              reload()
            }}
          />
        </div>
      )}
    </>
  )
}
