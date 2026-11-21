"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Bot, CircleAlert, CircleCheck, CircleX, Minus } from "lucide-react"

import { SeverityBadge } from "@/components/sentra/severity-badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ATTEMPT_STATUS_LABEL,
  type AgentTrail,
  type AttemptItem,
  REFINEMENT_STATE_LABEL,
  type RefinementState,
  type RunDetail,
  formatCount,
  listAttempts,
} from "@/lib/campaigns"
import { FINDING_STATUS_LABEL, IN_RUN_LABEL, type FindingItem } from "@/lib/findings"
import { formatDateTime } from "@/lib/targets"

const PAGE_SIZE = 25

function TableFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    // The frame is the one scrolling region (labelled, and reachable by keyboard); the table inside it
    // doesn't scroll on its own.
    <div
      className="overflow-x-auto rounded-[10px] border [&_[data-slot=table-container]]:overflow-visible"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  )
}

/** The findings of the run, with how reliably each was reproduced (incomplete ones are labelled). */
function FindingsTab({ findings, total }: { findings: FindingItem[]; total: number }) {
  if (findings.length === 0) {
    return <p className="rounded-[10px] border bg-card p-5 text-sm text-muted-foreground">This run found nothing.</p>
  }
  return (
    <div className="space-y-2">
      <TableFrame label="Findings of this run">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-normal">Severity</TableHead>
              <TableHead className="whitespace-normal">Finding</TableHead>
              <TableHead className="whitespace-normal">Category</TableHead>
              <TableHead className="whitespace-normal">In this run</TableHead>
              <TableHead className="whitespace-normal">Reproducibility</TableHead>
              <TableHead className="whitespace-normal">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {findings.map((finding) => (
              <TableRow key={finding.code}>
                <TableCell className="whitespace-normal">
                  <SeverityBadge severity={finding.severity} />
                </TableCell>
                <TableCell className="min-w-32 whitespace-normal">
                  <Link href={`/findings/${finding.code}`} className="font-mono text-xs text-link hover:underline">
                    {finding.code}
                  </Link>
                  <span className="block text-sm">{finding.title}</span>
                </TableCell>
                <TableCell className="whitespace-normal text-sm text-muted-foreground">{finding.category}</TableCell>
                <TableCell className="whitespace-normal text-sm">
                  {finding.in_run ? IN_RUN_LABEL[finding.in_run] : "–"}
                </TableCell>
                <TableCell className="min-w-28 whitespace-normal text-sm">
                  {finding.repetitions ? (
                    <>
                      <span className="tabular">{finding.repetitions.label}</span>
                      {finding.repetitions.status !== "complete" && (
                        <span className="block text-xs text-muted-foreground">
                          {finding.repetitions.status === "measuring" ? "Still being measured" : "Incomplete"}
                          {finding.repetitions.reason ? `: ${finding.repetitions.reason}` : ""}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Not measured yet</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal text-sm">{FINDING_STATUS_LABEL[finding.status]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>
      {total > findings.length && (
        <p className="text-xs text-muted-foreground">
          Showing the first {formatCount(findings.length)} of {formatCount(total)}.{" "}
          <Link href="/findings" className="text-link underline underline-offset-2">
            Open all findings
          </Link>
        </p>
      )}
    </div>
  )
}

/** Every attempt of the run, a page at a time; the text of each one opens on demand. */
function AttemptsTab({ code, number }: { code: string; number: number }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: AttemptItem[]; total: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadedPage, setLoadedPage] = useState(0)
  const [attempt, setAttempt] = useState(0) // changes to read the page again after a failure

  useEffect(() => {
    const controller = new AbortController()
    listAttempts(
      code,
      number,
      new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) }),
      controller.signal,
    )
      .then((found) => {
        setData(found)
        setFailed(false)
        setLoadedPage(page)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [code, number, page, attempt])

  if (failed) {
    return (
      <div className="space-y-2 rounded-[10px] border bg-card p-5">
        <p className="flex items-start gap-2 text-sm text-warning">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          The attempts couldn&apos;t be loaded.
        </p>
        <Button variant="outline" className="h-8" onClick={() => setAttempt((count) => count + 1)}>
          Try again
        </Button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading the attempts">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }
  if (data.total === 0) {
    return <p className="rounded-[10px] border bg-card p-5 text-sm text-muted-foreground">This run sent no attempts.</p>
  }

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  return (
    <div className="space-y-2" aria-busy={loadedPage !== page}>
      <TableFrame label="Attempts of this run">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-normal">No.</TableHead>
              <TableHead className="whitespace-normal">Test</TableHead>
              <TableHead className="whitespace-normal">Written by</TableHead>
              <TableHead className="whitespace-normal">Status</TableHead>
              <TableHead className="whitespace-normal">Time</TableHead>
              <TableHead className="whitespace-normal">Text</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((attempt) => (
              <TableRow key={attempt.attempt_no}>
                <TableCell className="whitespace-normal tabular text-sm">{attempt.attempt_no}</TableCell>
                <TableCell className="whitespace-normal font-mono text-xs">{attempt.test_code}</TableCell>
                <TableCell className="min-w-36 whitespace-normal text-sm">
                  {attempt.refinement_reason ? (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <Bot className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        Adaptive agent
                      </span>
                      <span className="block text-xs text-muted-foreground">{attempt.refinement_reason}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Planned test</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal text-sm">
                  {ATTEMPT_STATUS_LABEL[attempt.status]}
                  {attempt.error_message && (
                    <span className="block whitespace-normal text-xs text-destructive">{attempt.error_message}</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal tabular text-sm text-muted-foreground">
                  {attempt.duration_ms !== null ? `${formatCount(attempt.duration_ms)} ms` : "–"}
                </TableCell>
                <TableCell className="min-w-32 whitespace-normal">
                  <details className="text-sm">
                    <summary className="cursor-pointer text-link">Show</summary>
                    <p className="mt-2 text-xs font-medium">Sent</p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/40 p-2 text-xs">
                      {attempt.input}
                    </pre>
                    <p className="mt-2 text-xs font-medium">Reply</p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/40 p-2 text-xs">
                      {attempt.reply ?? "No reply"}
                    </pre>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="tabular text-muted-foreground">
          {formatCount((page - 1) * PAGE_SIZE + 1)}–{formatCount(Math.min(page * PAGE_SIZE, data.total))} of{" "}
          {formatCount(data.total)}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button variant="outline" className="h-8" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

const STATE_ICON: Record<RefinementState, React.ReactNode> = {
  sent: <CircleCheck className="size-4 text-success" aria-hidden="true" />,
  discarded: <CircleX className="size-4 text-warning" aria-hidden="true" />,
  refused: <Minus className="size-4 text-muted-foreground" aria-hidden="true" />,
  stopped: <CircleAlert className="size-4 text-warning" aria-hidden="true" />,
}

/** Every request to the agent with its reason, so a reviewer sees what it did and what Sentra refused. */
function RefinementsTab({ agent, settings }: { agent: AgentTrail | null; settings: RunDetail["settings"] }) {
  if (!agent) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading the refinements">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }
  if (!agent.enabled && settings.adaptive_agent !== true) {
    return (
      <p className="rounded-[10px] border bg-card p-5 text-sm text-text-secondary">
        The adaptive testing agent was switched off for this campaign, so every attempt of the run was a planned test.
      </p>
    )
  }
  if (agent.items.length === 0) {
    return (
      <p className="rounded-[10px] border bg-card p-5 text-sm text-text-secondary">
        The agent made no refinements in this run: every test that it could have followed up reached its objective, or
        the run ended first.
      </p>
    )
  }
  return (
    <ol className="divide-y rounded-[10px] border bg-card" aria-label="Adaptive refinements, newest first">
      {agent.items.map((item, index) => (
        <li key={`${item.created_at}-${index}`} className="flex gap-3 p-4">
          <span className="mt-0.5 shrink-0">{STATE_ICON[item.state]}</span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium">{REFINEMENT_STATE_LABEL[item.state]}</span>
              <span className="font-mono text-xs text-muted-foreground">{item.test_code}</span>
              <span className="tabular text-xs text-muted-foreground">{formatDateTime(item.created_at)}</span>
            </p>
            <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">{item.reason}</p>
            {(item.model || item.instructions_version) && (
              <p className="text-xs text-muted-foreground">
                {item.model ? `Model ${item.model}` : ""}
                {item.model && item.instructions_version ? " · " : ""}
                {item.instructions_version ? `Instructions ${item.instructions_version}` : ""}
                {Number(item.cost_usd) > 0 ? ` · $${Number(item.cost_usd).toFixed(3)}` : ""}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

/** The versions and settings the run used. They are kept with the run, so a later change to a suite doesn't change it. */
function ConfigurationTab({ run, agent }: { run: RunDetail; agent: AgentTrail | null }) {
  const suites = Array.isArray(run.versions.suites) ? (run.versions.suites as { code: string; version: number }[]) : []
  const threatModel = typeof run.versions.threat_model === "number" ? run.versions.threat_model : null
  const tests = Array.isArray(run.versions.tests) ? run.versions.tests.length : 0
  const models = Array.from(new Set((agent?.items ?? []).map((item) => item.model).filter(Boolean)))
  const settings = run.settings
  const timeWindow =
    settings.window_start && settings.window_end
      ? `${settings.window_start}–${settings.window_end} (${settings.time_zone})`
      : "Any time"

  return (
    <dl className="divide-y rounded-[10px] border bg-card px-5">
      <Row term="Target">
        <Link href={`/targets/${run.target.id}`} className="text-link underline underline-offset-2">
          {run.target.name}
        </Link>
      </Row>
      <Row term="Threat model">
        {threatModel !== null ? `Version ${threatModel}` : "None was approved when the run started"}
      </Row>
      <Row term="Test suites">
        {suites.length === 0 ? (
          "None"
        ) : (
          <ul className="space-y-0.5">
            {suites.map((suite) => (
              <li key={suite.code}>
                <span className="font-mono text-xs">{suite.code}</span>{" "}
                <span className="text-muted-foreground">version {suite.version}</span>
              </li>
            ))}
          </ul>
        )}
        <span className="block text-xs text-muted-foreground">{formatCount(tests)} tests in all</span>
      </Row>
      <Row term="Adaptive testing agent">
        {settings.adaptive_agent === true ? "On" : "Off"}
        {models.length > 0 && (
          <span className="block text-xs text-muted-foreground">Model used: {models.join(", ")}</span>
        )}
        {settings.adaptive_agent === true && models.length === 0 && (
          <span className="block text-xs text-muted-foreground">The agent called no model in this run.</span>
        )}
      </Row>
      <Row term="Attempt budget">{formatCount(Number(settings.attempt_budget ?? run.attempt_budget))}</Row>
      <Row term="Request rate">{`${run.request_rate} per minute`}</Row>
      <Row term="Repetitions">{String(settings.repetitions ?? "–")}</Row>
      <Row term="Time window">{timeWindow}</Row>
      <Row term="Launched by">{run.launched_by ?? "a former member"}</Row>
    </dl>
  )
}

/**
 * The tabs of a finished run (Screen 37): its findings, every attempt, what the adaptive testing
 * agent refined and why, and the versions and settings the run used.
 */
export function RunResults({
  run,
  findings,
  findingsTotal,
  agent,
}: {
  run: RunDetail
  findings: FindingItem[]
  findingsTotal: number
  agent: AgentTrail | null
}) {
  const [tab, setTab] = useState("findings")
  return (
    <Tabs value={tab} onValueChange={setTab} className="min-w-0">
      <div>
        <TabsList
          variant="line"
          aria-label="Results of the run"
          className="h-auto w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto"
        >
          <TabsTrigger value="findings" className="flex-none px-2">
            Findings ({formatCount(findingsTotal)})
          </TabsTrigger>
          <TabsTrigger value="attempts" className="flex-none px-2">
            Attempts ({formatCount(run.attempts_sent)})
          </TabsTrigger>
          <TabsTrigger value="refinements" className="flex-none px-2">
            Adaptive refinements ({formatCount(agent?.sent ?? 0)})
          </TabsTrigger>
          <TabsTrigger value="configuration" className="flex-none px-2">
            Configuration and versions
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="findings">
        <FindingsTab findings={findings} total={findingsTotal} />
      </TabsContent>
      <TabsContent value="attempts">
        <AttemptsTab code={run.campaign.code} number={run.number} />
      </TabsContent>
      <TabsContent value="refinements">
        <RefinementsTab agent={agent} settings={run.settings} />
      </TabsContent>
      <TabsContent value="configuration">
        <ConfigurationTab run={run} agent={agent} />
      </TabsContent>
    </Tabs>
  )
}
