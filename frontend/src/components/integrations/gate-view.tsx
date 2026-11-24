"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { GateRuns } from "@/components/integrations/gate-runs"
import { IntegrationsTabs } from "@/components/integrations/integrations-tabs"
import { CopyButton } from "@/components/sentra/copy-button"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { APPROVAL_WORDS, type Gate, changeGate, getGate, pipelineCommand } from "@/lib/gates"
import { useCan } from "@/lib/permissions"
import { ENVIRONMENT_LABEL, formatDate } from "@/lib/targets"
import { cn } from "@/lib/utils"

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b py-2 last:border-b-0">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="text-right text-[13px]">{children}</dd>
    </div>
  )
}

/** Screen 55: one gate — what it checks, how a pipeline calls it, and every release it judged. */
export function GateView({ code }: { code: string }) {
  const canManage = useCan("manage_security_gates")
  // A gate that blocked a release links the developer straight to that release (UC-9.5, 5a1).
  const release = Number(useSearchParams().get("release")) || undefined
  const [gate, setGate] = useState<Gate | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState("")

  // The top bar already shows "Governance / Integrations", so these are the steps after it.
  usePageCrumbs(
    gate ? [{ label: "Security Gates", href: "/integrations" }, { label: gate.name }] : [],
  )

  const load = useCallback(
    (signal?: AbortSignal) => {
      getGate(code, signal)
        .then(setGate)
        .catch((error) => {
          if (error instanceof ApiError && error.status === 404) setNotFound(true)
        })
    },
    [code],
  )

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const setStatus = async (status: "active" | "paused") => {
    setBusy(true)
    setProblem("")
    try {
      setGate(await changeGate(code, { status }))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (notFound) {
    return (
      <EmptyState
        title="Security gate not found"
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/integrations">Back to the security gates</Link>
          </Button>
        }
      />
    )
  }
  if (!gate) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the security gate">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const command = pipelineCommand(gate.code)
  return (
    <div>
      <PageHeader
        title={gate.name}
        description={gate.target_name}
        action={
          canManage ? (
            <Button
              variant="outline"
              className="h-9"
              disabled={busy}
              onClick={() => setStatus(gate.status === "active" ? "paused" : "active")}
            >
              {gate.status === "active" ? "Pause the gate" : "Make the gate active"}
            </Button>
          ) : undefined
        }
      />
      <IntegrationsTabs active="gates" />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-xs",
            gate.status === "active"
              ? "border-success/40 bg-success/5 text-success"
              : "border-border-strong text-text-secondary",
          )}
        >
          {gate.status === "active" ? "Active" : "Paused"}
        </span>
        <span className="font-mono text-[13px]">{gate.code}</span>
        <CopyButton text={gate.code} description="Copy the gate's identifier" />
      </div>

      {problem && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-5">
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <section aria-labelledby="policy" className="rounded-[10px] border bg-card p-5">
            <h2 id="policy" className="mb-2 text-[15px] font-semibold">
              Gate policy
            </h2>
            <dl>
              <Row term="Target">
                <Link
                  href={`/targets/${gate.target_id}`}
                  className="text-link underline underline-offset-2"
                >
                  {gate.target_name}
                </Link>
                <div className="text-xs text-text-secondary">
                  {ENVIRONMENT_LABEL[gate.target_environment]}
                </div>
              </Row>
              <Row term="Campaign">
                <Link
                  href={`/campaigns/${gate.campaign_code}`}
                  className="text-link underline underline-offset-2"
                >
                  {gate.campaign_name}
                </Link>
                <div className="font-mono text-xs text-muted-foreground">{gate.campaign_code}</div>
              </Row>
              <Row term={gate.suites.length === 1 ? "Test suite" : "Test suites"}>
                {gate.suites.length === 0 ? (
                  <span className="text-text-secondary">None, so a run would send nothing</span>
                ) : (
                  <ul>
                    {gate.suites.map((suite) => (
                      <li key={suite.code}>
                        {suite.name}
                        <span className="text-xs text-text-secondary">
                          {suite.found
                            ? ` v${suite.version} · ${suite.test_count} ${
                                suite.test_count === 1 ? "test" : "tests"
                              }`
                            : " — archived, so a run skips it"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Row>
              <Row term="Attempt budget">
                <span className="tabular">{gate.attempt_budget}</span> per run
              </Row>
              <Row term="Scope approval">
                {APPROVAL_WORDS[gate.approval_status]}
              </Row>
              <Row term="Fails on a new finding of">
                <span className="flex flex-wrap justify-end gap-1">
                  {gate.fail_on.map((severity) => (
                    <SeverityBadge key={severity} severity={severity} />
                  ))}
                </span>
              </Row>
              <Row term="A fixed finding that comes back">
                {gate.fail_on_reopened ? "Fails the release" : "Does not fail the release"}
              </Row>
              <Row term="Baseline">
                {gate.baseline_run_code ? (
                  <>
                    <span className="font-mono">{gate.baseline_run_code}</span>
                    {gate.baseline_at && (
                      <div className="text-xs text-text-secondary">
                        {formatDate(gate.baseline_at)}
                      </div>
                    )}
                  </>
                ) : (
                  "The first completed run becomes it"
                )}
              </Row>
              <Row term="Set up by">
                {gate.created_by ?? "—"}
                <div className="text-xs text-muted-foreground">{formatDate(gate.created_at)}</div>
              </Row>
            </dl>
            <p className="mt-3 border-t pt-3 text-[13px] text-muted-foreground">
              {gate.policy_words.charAt(0).toUpperCase() + gate.policy_words.slice(1)}, compared
              with the last run this gate accepted.
            </p>
          </section>

          <section aria-labelledby="pipeline" className="rounded-[10px] border bg-card p-5">
            <h2 id="pipeline" className="mb-2 text-[15px] font-semibold">
              Add it to your pipeline
            </h2>
            <div className="flex items-start gap-2 rounded-[7px] border bg-muted/40 p-3">
              <code className="min-w-0 flex-1 font-mono text-xs break-all">{command}</code>
              <CopyButton text={command} description="Copy the pipeline command" />
            </div>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Store the API key as the pipeline secret <code className="font-mono">SENTRA_API_KEY</code>.
              It needs the scopes &ldquo;Run security gate&rdquo; and &ldquo;Read gate
              results&rdquo; —{" "}
              <Link href="/integrations/api-keys" className="text-link underline underline-offset-2">
                make one under API keys
              </Link>
              .
            </p>
            <p className="mt-2 text-[13px]">The gate fails if a run is stopped or cut short.</p>
          </section>
        </div>

        <section
          aria-labelledby="releases"
          className="min-w-0 space-y-3 rounded-[10px] border bg-card p-5"
        >
          <h2 id="releases" className="text-[15px] font-semibold">
            Releases ({gate.runs.length})
          </h2>
          <p className="text-[13px] text-muted-foreground">What the gate decided, newest first.</p>
          <GateRuns runs={gate.runs} release={release} />
        </section>
      </div>
    </div>
  )
}
