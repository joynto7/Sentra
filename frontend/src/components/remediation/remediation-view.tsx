"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { StatusChip } from "@/components/remediation/badges"
import { FixCard } from "@/components/remediation/fix-card"
import { FilterSelect } from "@/components/sentra/filter-select"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { AiGeneratedLabel } from "@/components/threat-models/badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type RemediationPage as Page,
  getRemediation,
  getRemediationJob,
  requestRemediation,
} from "@/lib/remediation"
import { formatDateTime } from "@/lib/targets"

const POLL = 2000

/**
 * Screen 46: one version of the proposal for a finding (UC-8.2). It shows the root cause, the
 * fixes with their kind and where each takes effect, and which version is being read. Every
 * version is a draft: approving one, adapting it and rejecting it come with FR-8.2, and the
 * retest with FR-8.5.
 */
export function RemediationView({ code }: { code: string }) {
  const canRequest = useCan("request_remediations")
  const [version, setVersion] = useState<number | null>(null)
  const [data, setData] = useState<Page | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  usePageCrumbs([{ label: code }])

  useEffect(() => {
    const controller = new AbortController()
    getRemediation(code, version ?? undefined, controller.signal)
      .then((found) => {
        setData(found)
        setError(null)
      })
      .catch((problem) => {
        if (controller.signal.aborted) return
        setError(problem instanceof ApiError ? problem.message : "The proposal could not be loaded.")
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
      toast.error(problem instanceof ApiError ? problem.message : "The proposal could not be asked for.")
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

  return (
    <>
      <PageHeader
        title={`Remediation for ${data.finding.code}`}
        description={data.finding.title}
        action={
          canRequest &&
          !data.blocker &&
          data.current !== null && (
            <Button className="h-9 hover:bg-primary-hover" onClick={ask} disabled={busy || Boolean(running)}>
              {running ? "Writing…" : busy ? "Asking…" : askLabel}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <SeverityBadge severity={data.finding.severity} />
        <Link href={`/findings/${data.finding.code}`} className="py-1 text-link hover:underline">
          Open the finding
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={`/targets/${data.finding.target_id}`} className="py-1 text-link hover:underline">
          {data.finding.target_name}
        </Link>
        <span className="text-muted-foreground">· {data.finding.component}</span>
      </div>

      {data.blocker && (
        <Alert role="status" className="mb-4">
          <AlertDescription>{data.blocker}</AlertDescription>
        </Alert>
      )}

      {running && (
        <Alert role="status" className="mb-4">
          <AlertDescription>
            Sentra is writing the proposal. It reads the finding, its evidence and the Target Profile,
            and this page shows the version as soon as it is there.
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
                "Ask Sentra for a proposal: it reads the finding, its evidence and the Target Profile and recommends how to fix it.")
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
        <div className="space-y-4">
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
              Asked for by {current.requested_by ?? "someone"} on {formatDateTime(current.created_at)}
              {current.dropped > 0 &&
                ` · ${current.dropped} ${current.dropped === 1 ? "fix was" : "fixes were"} left out because Sentra could not use ${current.dropped === 1 ? "it" : "them"}`}
            </p>
            <h3 className="mt-4 text-[13px] font-medium text-muted-foreground">Root cause</h3>
            <p className="mt-1 text-sm">{current.root_cause}</p>
            <h3 className="mt-3 text-[13px] font-medium text-muted-foreground">What the fixes do</h3>
            <p className="mt-1 text-sm">{current.summary}</p>
            {current.mitigation_only && (
              <p className="mt-3 rounded-[7px] border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
                {current.mitigation_only}
              </p>
            )}
            <p className="mt-3 border-t pt-3 text-[13px] text-muted-foreground">
              This is a draft. Nothing it recommends takes effect until a person approves it, which
              comes with the review of FR-8.2.
            </p>
          </section>

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
        </div>
      )}
    </>
  )
}
