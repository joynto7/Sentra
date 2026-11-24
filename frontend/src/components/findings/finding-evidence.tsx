"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import { ArchiveX, CircleCheck, EyeOff, Lock, TriangleAlert } from "lucide-react"

import { onlyJudgeSupports } from "@/components/findings/judge-only"
import { ConfirmationNotice } from "@/components/findings/finding-badges"
import { FindingHeader } from "@/components/findings/finding-header"
import { FindingTabs } from "@/components/findings/finding-tabs"
import { OPEN_STATUSES } from "@/lib/risk"
import { EmptyState } from "@/components/layout/empty-state"
import { AiGeneratedLabel } from "@/components/threat-models/badges"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import {
  type CountedAttempt,
  type EvidenceDetail,
  type EvidenceItem,
  type EvidenceResult,
  type FindingDetail,
  type Measurement,
  type Reproducibility,
  getEvidence,
  getFinding,
  getReproducibility,
  listEvidence,
} from "@/lib/findings"
import { formatDateTime } from "@/lib/targets"
import { cn } from "@/lib/utils"

const METHOD_LABEL: Record<string, string> = {
  canary_token: "Canary token",
  rule_matching: "Rule matching",
  tool_call_inspection: "Tool-call inspection",
  llm_judge: "LLM judge",
}

/** The attempts of one run shown before "Show all": the design lists ten repetitions. */
const FIRST_ROWS = 10
/** More attempts than this fold every run but the first and the one whose evidence is open. */
const MANY = 20

function clock(iso: string | null | undefined, precise = false): string {
  if (!iso) return ""
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...(precise ? { fractionalSecondDigits: 3 as const } : {}),
  })
}

/** A record is its finding and its number: a duplicate merged into this finding numbers its own. */
const keyOf = (record: { finding: string; number: number }) => `${record.finding}#${record.number}`

/** An attempt that reproduced the weakness. Once the retention clean-up has deleted evidence (UC-6.5,
 * 4a), a met attempt of this finding has nothing left to prove it, and still counts. */
const reproduced = (row: CountedAttempt, evidenceDeleted: boolean) =>
  row.success || (evidenceDeleted && row.outcome === "met" && !row.evidence && !row.other_finding)

/** The placeholders the masking of the LLM layer writes, e.g. [EMAIL_1] or [SECRET_2], and [MASKED]. */
const PLACEHOLDER = /(\[(?:MASKED[^\]]*|[A-Z][A-Z_]*_\d+)\])/

/**
 * The target's own text: plain, masked, never rendered as active content (NFR-3.6). Masked values
 * stand out, so a reader sees where personal data was taken out before storage.
 */
function Masked({ text }: { text: string }) {
  return (
    <>
      {text.split(PLACEHOLDER).map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="rounded-sm bg-background px-0.5 ring-1 ring-border">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

function TargetText({ text }: { text: string }) {
  return (
    <p className="rounded-[7px] border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap text-text-secondary">
      <Masked text={text} />
    </p>
  )
}

/** Met or not met as Screen 40 marks it: a filled red mark where the weakness showed, a hollow one
 * where it didn't, and always the words beside the mark (Screen 00-05: never colour alone). */
function Outcome({ outcome, className }: { outcome: string; className?: string }) {
  const met = outcome === "met"
  const notMet = outcome === "not_met"
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border bg-card px-2 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          met ? "bg-destructive" : notMet ? "border border-foreground/60" : "border border-dashed border-foreground/60",
        )}
      />
      {met ? "Met" : notMet ? "Not met" : outcome === "pending" ? "Waiting for the judge" : "Not evaluated"}
    </span>
  )
}

// ---------------------------------------------------------------- tool calls as calls (row 40-4)

type Call = { name: string; args: string; result: string | null }

function plain(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}

/**
 * One tool call as a call — `lookup_customer(order_id = [MASKED])` — and what it returned, when the
 * target says. Targets name their calls in different formats (the response format of FR-2.2, M2): OpenAI's
 * `function`, Anthropic's `tool_use` with `input`, or a plain name with arguments. A format this
 * doesn't know returns null, and the page shows what was stored instead.
 */
function asCall(raw: unknown): Call | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const call = raw as Record<string, unknown>
  const inner =
    call.function && typeof call.function === "object" ? (call.function as Record<string, unknown>) : call
  const name = typeof inner.name === "string" ? inner.name : typeof call.tool === "string" ? call.tool : null
  if (!name) return null
  let args: unknown = inner.arguments ?? call.arguments ?? call.input ?? call.args ?? call.parameters
  if (typeof args === "string") {
    try {
      args = JSON.parse(args)
    } catch {
      // arguments that aren't JSON are shown as the target sent them
    }
  }
  const listed =
    args && typeof args === "object" && !Array.isArray(args)
      ? Object.entries(args as Record<string, unknown>)
          .map(([key, value]) => `${key} = ${plain(value)}`)
          .join(", ")
      : args === undefined || args === null
        ? ""
        : plain(args)
  const result = call.result ?? call.output ?? call.response ?? call.content
  return { name, args: listed, result: result === undefined || result === null ? null : plain(result) }
}

function ToolCalls({ calls }: { calls: unknown }) {
  const list = Array.isArray(calls) ? calls : [calls]
  const parsed = list.map(asCall)
  if (parsed.some((call) => call === null)) {
    return <TargetText text={typeof calls === "string" ? calls : JSON.stringify(calls, null, 2)} />
  }
  return (
    <ul className="space-y-1.5">
      {(parsed as Call[]).map((call, index) => (
        <li
          key={index}
          className="rounded-[7px] border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap text-text-secondary"
        >
          <Masked text={`${call.name}(${call.args})`} />
          {call.result !== null && (
            <>
              {"\n"}
              <span aria-hidden="true">→ </span>
              <Masked text={`returned ${call.result}`} />
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------- the left column (rows 40-2, 40-3)

function Bar({ share }: { share: number }) {
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.max(share * 100, 2)}%` }} />
    </div>
  )
}

/** What one run's measurement says (UC-6.3): done, cut short and why (2a1, 2b1), or still going. */
function MeasurementLine({ measurement, listed }: { measurement: Measurement | null; listed: number }) {
  if (!measurement) return null
  const of = `${listed} of the ${measurement.wanted} attempts the campaign asked for`
  if (measurement.status === "measuring") {
    return <p className="text-xs text-muted-foreground">Still measuring: {of} so far.</p>
  }
  if (measurement.status === "incomplete") {
    return (
      <p className="text-xs text-text-secondary">
        <TriangleAlert className="mr-1 inline size-3.5 align-[-2px] text-warning" aria-hidden="true" />
        Incomplete, based on {of}. {measurement.reason}
      </p>
    )
  }
  return}

function AttemptRow({
  row,
  evidenceDeleted,
  selected,
  onOpen,
}: {
  row: CountedAttempt
  evidenceDeleted: boolean
  selected: string | null
  onOpen: (key: string) => void
}) {
  const label = (
    <>
      <span className="tabular w-8 shrink-0 font-mono text-[13px] font-medium">#{row.position}</span>
      <span className="min-w-0 flex-1">
        <span className="tabular block font-mono text-[13px]">{clock(row.sent_at)}</span>
        <span className="block text-xs text-muted-foreground">
          Attempt {row.attempt_no}
          {row.repeat ? " · repetition" : ""}
          {/* A duplicate merged into this finding keeps its own evidence (FR-6.6, M6) */}
          {row.evidence && !row.success ? ` · evidence of ${row.evidence.finding}` : ""}
          {/* A met attempt always records evidence (UC-6.2); one that failed to is said, not hidden */}
          {row.outcome === "met" && !row.evidence && !row.other_finding
            ? evidenceDeleted
              ? " · evidence deleted"
              : " · no evidence recorded"
            : ""}
          {row.other_finding && (
            <>
              {" · evidence of "}
              <Link href={`/findings/${row.other_finding}/evidence`} className="text-link underline underline-offset-2">
                {row.other_finding}
              </Link>
            </>
          )}
        </span>
      </span>
      <Outcome outcome={row.outcome} />
    </>
  )
  if (row.evidence) {
    const key = keyOf(row.evidence)
    const current = key === selected
    return (
      <li>
        <button
          type="button"
          onClick={() => onOpen(key)}
          aria-current={current ? "true" : undefined}
          className={cn(
            "flex min-h-11 w-full items-center gap-2 rounded-[7px] border px-2.5 py-1.5 text-left",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            current ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted",
          )}
        >
          {label}
        </button>
      </li>
    )
  }
  return <li className="flex min-h-11 items-center gap-2 px-2.5 py-1.5">{label}</li>
}

function RunGroup({
  group,
  foldable,
  startOpen,
  evidenceDeleted,
  selected,
  onOpen,
}: {
  group: Reproducibility["runs"][number]
  /** Many attempts make every run foldable, so the column stays an overview. */
  foldable: boolean
  startOpen: boolean
  evidenceDeleted: boolean
  selected: string | null
  onOpen: (key: string) => void
}) {
  const [open, setOpen] = useState(startOpen)
  const [all, setAll] = useState(false)
  const listId = useId()
  const rows = group.attempts
  const shown = all ? rows : rows.slice(0, FIRST_ROWS)
  const met = rows.filter((row) => reproduced(row, evidenceDeleted)).length
  // The repetitions of one benchmark run share its code (BR-012), so the date tells them apart
  const started = rows[0]?.sent_at ? formatDateTime(rows[0].sent_at) : null
  return (
    <section aria-labelledby={`${listId}-run`} className="border-t px-3 pt-3 pb-2 first:border-t-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={`${listId}-run`} className="text-[13px]">
          <span className="font-mono font-semibold">{group.run.code}</span>
          {started && <span className="text-xs text-muted-foreground"> · {started}</span>}
        </h3>
        {rows.length > 0 && (
          <span className="tabular shrink-0 text-xs text-muted-foreground">
            {met} of {rows.length} met
          </span>
        )}
      </div>
      <MeasurementLine measurement={group.measurement} listed={rows.length} />
      {rows.length === 0 ? null : (
        // Always there, so the buttons that open it have the list they control
        <ol id={listId} hidden={!open} className="mt-1.5 space-y-0.5">
          {open &&
            shown.map((row) => (
              <AttemptRow
                key={row.position}
                row={row}
                evidenceDeleted={evidenceDeleted}
                selected={selected}
                onOpen={onOpen}
              />
            ))}
        </ol>
      )}
      {/* One toggle that stays where it is, so the keyboard is never left on a button that went away
          (WCAG 2.4.3) */}
      {foldable && rows.length > 0 && (
        <Button
          id={`${listId}-fold`}
          variant="ghost"
          size="sm"
          className="mt-1 h-9 text-link"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((now) => !now)}
        >
          {open
            ? rows.length === 1
              ? "Hide its attempt"
              : `Hide its ${rows.length} attempts`
            : rows.length === 1
              ? "Show its attempt"
              : `Show its ${rows.length} attempts`}
        </Button>
      )}
      {open && rows.length > FIRST_ROWS && (
        <Button
          id={`${listId}-more`}
          variant="ghost"
          size="sm"
          className="mt-1 h-9 text-link"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((now) => !now)}
        >
          {all ? "Show the first ten" : `Show all ${rows.length} attempts`}
        </Button>
      )}
    </section>
  )
}

function RecordButton({
  record,
  finding,
  selected,
  onOpen,
}: {
  record: EvidenceItem
  finding: string
  selected: string | null
  onOpen: (key: string) => void
}) {
  const key = keyOf(record)
  const current = key === selected
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(key)}
        aria-current={current ? "true" : undefined}
        className={cn(
          "flex min-h-11 w-full flex-col items-start rounded-[7px] border px-2.5 py-1.5 text-left",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          current ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted",
        )}
      >
        <span className="font-mono text-[13px]">
          {record.run.code} · Attempt {record.attempt_no}
        </span>
        <span className="text-xs text-muted-foreground">
          {record.kind === "judge_verdict" ? "The LLM judge's later answer" : "The attempt"}
          {record.finding !== finding ? `, evidence of ${record.finding}` : ""} · {formatDateTime(record.recorded_at)}
        </span>
      </button>
    </li>
  )
}

/**
 * Screen 40's left column: the reproducibility of the finding — every attempt the score counts, by
 * campaign run, met or not (UC-6.3; quality requirement 4: a rate over repeated attempts) — where
 * each attempt that met opens its evidence. Evidence that isn't one of those attempts, such as the
 * LLM judge's later answer, is listed below them.
 */
function EvidenceList({
  finding,
  records,
  score,
  scoreFailed,
  onRetryScore,
  selected,
  onOpen,
}: {
  finding: FindingDetail
  records: EvidenceItem[]
  score: Reproducibility | null
  scoreFailed: Problem | null
  onRetryScore: () => void
  selected: string | null
  onOpen: (key: string) => void
}) {
  const covered = new Set(
    (score?.runs ?? []).flatMap((group) => group.attempts.flatMap((row) => (row.evidence ? [keyOf(row.evidence)] : []))),
  )
  const others = records.filter((record) => !covered.has(keyOf(record)))
  const deleted = Boolean(finding.evidence_deleted)
  const successes = !score
    ? 0
    : deleted
      ? score.runs.flatMap((group) => group.attempts).filter((row) => reproduced(row, true)).length
      : score.successes
  const share = score && score.attempts > 0 ? successes / score.attempts : 0
  return (
    <section aria-labelledby="evidence-by-run" className="min-w-0 rounded-[10px] border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 id="evidence-by-run" className="text-[15px] font-semibold">
          Evidence by campaign run
        </h2>
        <span className="tabular inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-xs font-medium">
          {records.length}
          <span className="sr-only">{records.length === 1 ? " record" : " records"}</span>
        </span>
      </div>

      {finding.evidence_deleted && (
        <p className="border-b px-4 py-2.5 text-xs text-text-secondary">
          {finding.evidence_deleted.count === 1
            ? "1 earlier evidence record was"
            : `${finding.evidence_deleted.count} earlier evidence records were`}{" "}
          deleted at the end of their retention period.
        </p>
      )}

      {scoreFailed ? (
        <div role="alert" className="space-y-2 border-b px-4 py-3 text-sm">
          <p className="text-text-secondary">{scoreFailed.text}</p>
          <ProblemActions problem={scoreFailed} onRetry={onRetryScore} />
        </div>
      ) : !score ? (
        <div className="space-y-2 px-4 py-3" role="status" aria-label="Loading the reproducibility">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <div className="border-b px-4 py-3">
            {score.attempts === 0 ? (
              <p className="text-sm text-muted-foreground">Reproducibility: nothing evaluated yet.</p>
            ) : (
              <>
                <p className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold">
                    Reproducibility: {successes} of {score.attempts} met
                  </span>
                  <span className="tabular text-muted-foreground">{Math.round(share * 100)} %</span>
                </p>
                <Bar share={share} />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Every attempt of this test against {finding.target.name}, in the order it was sent.
                  {score.shown < score.attempts ? ` The first ${score.shown} are listed.` : ""}
                </p>
              </>
            )}
          </div>
          {score.runs.map((group, index) => (
            <RunGroup
              key={group.run.id}
              group={group}
              evidenceDeleted={deleted}
              foldable={score.shown > MANY}
              startOpen={
                score.shown <= MANY ||
                index === 0 ||
                group.attempts.some((row) => row.evidence && keyOf(row.evidence) === selected)
              }
              selected={selected}
              onOpen={onOpen}
            />
          ))}
        </>
      )}

      {(scoreFailed || score) && others.length > 0 && (
        <section aria-labelledby="other-evidence" className="border-t px-3 pt-3 pb-2">
          <h3 id="other-evidence" className="px-1 text-xs font-semibold text-muted-foreground">
            {scoreFailed ? "Evidence records" : "Other evidence of this finding"}
          </h3>
          <ul className="mt-1.5 space-y-0.5">
            {others.map((record) => (
              <RecordButton key={keyOf(record)} record={record} finding={finding.code} selected={selected} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- the centre and the right column

function Step({
  number,
  title,
  at,
  children,
}: {
  number: number
  title: string
  /** Only a time the document holds for this step; a step without one shows none. */
  at?: string
  children?: React.ReactNode
}) {
  return (
    <li className="relative pl-10">
      <span
        className="tabular absolute top-0 left-0 inline-flex size-7 items-center justify-center rounded-full border bg-card text-xs font-medium"
        aria-hidden="true"
      >
        {number}
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          <span className="sr-only">Step {number}: </span>
          {title}
        </h3>
        {at && <span className="tabular font-mono text-xs text-muted-foreground">{at}</span>}
      </div>
      <div className="mt-1.5 space-y-2">{children}</div>
    </li>
  )
}

/** UC-6.5 step 5 and NFR-9.4: what each detection method found, the LLM judge with its reasoning,
 * its confidence and the model and instructions that gave it (NFR-9.6). */
function DetectionResult({ result }: { result: EvidenceResult }) {
  return (
    <li className="space-y-1.5 border-t px-4 py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{METHOD_LABEL[result.method] ?? result.method}</h3>
          <p className="text-xs text-muted-foreground">{result.role === "decisive" ? "Decisive" : "Supporting"}</p>
        </div>
        <Outcome outcome={result.outcome} />
      </div>
      <p className="text-sm text-text-secondary">{result.summary}</p>
      {Array.isArray(result.checks) && result.checks.length > 0 && (
        <ul className="space-y-1">
          {result.checks.map((check, index) => (
            <li key={index} className="text-xs text-muted-foreground">
              {check.sentence}
              {check.detail ? ` — ${check.detail}` : ""}
            </li>
          ))}
        </ul>
      )}
      {result.method === "llm_judge" && (
        <div className="space-y-1.5 border-t pt-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {result.confidence && (
              <span>
                Confidence <span className="tabular font-semibold">{Number(result.confidence).toFixed(2)}</span>
              </span>
            )}
            <AiGeneratedLabel />
          </div>
          {result.reasoning && <p className="text-xs text-text-secondary">{result.reasoning}</p>}
          <p className="text-xs text-muted-foreground">
            Model: {result.model ?? "unknown"}
            {result.deployment ? ` (${result.deployment})` : ""}
            {result.instructions_version ? ` · instructions v${result.instructions_version}` : ""}
          </p>
        </div>
      )}
    </li>
  )
}

type Shape = Record<string, unknown>
const isShape = (value: unknown): value is Shape => Boolean(value) && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === "string" ? value : null)

/**
 * The parts of a stored document this page shows, read without trusting its form: a document is
 * written once (FR-6.3, M6) and may come from an older form, or have been changed after it was stored
 * (NFR-2.4). A part that isn't there, or isn't what it should be, is left out — the page never
 * fails on a document.
 */
function read(shown: EvidenceDetail) {
  const content = shown.content as unknown
  if (!isShape(content)) return null
  const attempt = isShape(content.attempt) ? content.attempt : {}
  const reply = isShape(content.reply) && typeof content.reply.text === "string" ? content.reply : null
  const test = isShape(content.test) ? content.test : null
  const detection = isShape(content.detection) ? content.detection : null
  const verdict = detection && isShape(detection.verdict) ? detection.verdict : null
  const results = (detection && Array.isArray(detection.results) ? detection.results : []).filter(
    (result): result is EvidenceResult => isShape(result) && typeof result.method === "string",
  )
  return {
    run: text(content.campaign_run) ?? shown.run.code,
    attempt: typeof attempt.number === "number" ? attempt.number : shown.attempt_no,
    judgeAnswer: content.kind === "judge_verdict",
    test: test && text(test.code) ? { code: text(test.code)!, version: test.version, name: text(test.name) ?? "", condition: text(test.success_condition) } : null,
    message: text(attempt.message),
    sentAt: text(attempt.sent_at),
    conversation: text(attempt.conversation),
    template: text(attempt.template),
    variant: typeof attempt.variant === "number" ? attempt.variant : null,
    calls: content.tool_calls,
    reply: reply && {
      text: reply.text as string,
      receivedAt: text(reply.received_at),
      status: reply.status_code,
      duration: reply.duration_ms,
      length: typeof reply.length === "number" ? reply.length : null,
      truncated: reply.truncated === true,
    },
    outcome: verdict ? text(verdict.outcome) : null,
    summary: verdict ? text(verdict.summary) : null,
    results,
  }
}

function Document({
  shown,
  finding,
  objective,
}: {
  shown: EvidenceDetail
  finding: string
  /** The finding's test: its objective says in plain words what the attempt tries (NFR-4.2). */
  objective: { code: string; objective: string }
}) {
  const view = read(shown)
  if (!view) {
    return (
      <p className="rounded-[10px] border bg-card p-5 text-sm text-text-secondary">
        The stored document could not be read:{" "}
        {shown.integrity.status === "missing" ? "it is missing." : "it was changed after it was stored."}
      </p>
    )
  }
  const calls = view.calls
  const hasCalls = calls !== undefined && calls !== null && !(Array.isArray(calls) && calls.length === 0)
  let step = 0
  return (
    <div className="space-y-4">
      {shown.integrity.status !== "unchanged" && (
        <p role="note" className="flex items-start gap-2 rounded-[10px] border border-destructive/40 bg-card p-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            This document was changed after it was stored: its checksum no longer matches the one recorded with it.
            What is shown below may not be what Sentra recorded.
          </span>
        </p>
      )}
      <div className="rounded-[10px] border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">
            {view.run} · Attempt {view.attempt}
            {view.judgeAnswer ? ": the LLM judge's later answer" : ""}
          </h2>
          {view.outcome && <Outcome outcome={view.outcome} />}
        </div>
        {view.test && (
          <p className="mt-1 text-sm text-muted-foreground">
            Test definition <span className="font-mono text-xs">{view.test.code}</span>
            {typeof view.test.version === "number" ? ` v${view.test.version}` : ""}
            {view.test.name ? ` · ${view.test.name}` : ""}
          </p>
        )}
        {shown.finding !== finding && (
          <p className="mt-1 text-xs text-muted-foreground">
            Evidence of {shown.finding}, a duplicate merged into {finding}.
          </p>
        )}
      </div>

      {!view.judgeAnswer && (view.message || hasCalls || view.reply) && (
        <ol className="space-y-5 rounded-[10px] border bg-card p-5" aria-label="What happened, in order">
          <Step number={++step} title="Attempt sent" at={clock(view.sentAt, true)}>
            {objective.objective && view.test?.code === objective.code && (
              <p className="text-sm text-text-secondary">{objective.objective}</p>
            )}
            {view.message && <TargetText text={view.message} />}
            {(view.conversation || view.template) && (
              <p className="text-xs text-muted-foreground">
                Conversation {view.conversation ?? "–"} · template {view.template ?? "–"}
                {view.variant ? `, message ${view.variant}` : ""}
              </p>
            )}
          </Step>
          {hasCalls && (
            // The document records no time of its own for a tool call: it came with the reply
            <Step
              number={++step}
              title={Array.isArray(calls) && calls.length > 1 ? `Tool calls (${calls.length})` : "Tool call"}
            >
              <ToolCalls calls={calls} />
            </Step>
          )}
          {view.reply && (
            <Step number={++step} title="Target reply" at={clock(view.reply.receivedAt, true)}>
              <TargetText text={view.reply.text} />
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <EyeOff className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Shown as plain text. Personal data was masked before storage.
                  {typeof view.reply.status === "number" ? ` HTTP ${view.reply.status}` : ""}
                  {typeof view.reply.duration === "number" ? ` · ${view.reply.duration} ms` : ""}
                  {view.reply.length !== null ? ` · ${view.reply.length} characters` : ""}
                  {view.reply.truncated ? " (a long reply: only its beginning is kept)" : ""}
                </span>
              </p>
            </Step>
          )}
        </ol>
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border bg-card p-4 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
          Stored {formatDateTime(shown.recorded_at)}
        </span>
        <span className="text-muted-foreground">
          SHA-256{" "}
          <span className="font-mono text-xs">
            {shown.checksum.slice(0, 8)}…{shown.checksum.slice(-4)}
          </span>
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium",
            shown.integrity.status === "unchanged" ? "text-success" : "text-destructive",
          )}
        >
          {shown.integrity.status === "unchanged" ? (
            <CircleCheck className="size-4" aria-hidden="true" />
          ) : (
            <TriangleAlert className="size-4" aria-hidden="true" />
          )}
          {shown.integrity.status === "unchanged" ? "Unchanged" : shown.integrity.status === "missing" ? "Missing" : "Changed"}
        </span>
        <span className="text-muted-foreground">
          Read-only · {shown.size} bytes in the {shown.stored_in === "database" ? "database" : "object storage"}
        </span>
      </p>
    </div>
  )
}

function Detection({ shown, failed = false }: { shown: EvidenceDetail | null; failed?: boolean }) {
  const view = shown ? read(shown) : null
  const results = view?.results ?? []
  const met = results.filter((result) => result.outcome === "met").length
  return (
    <section aria-labelledby="detection-results" className="min-w-0 rounded-[10px] border bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
        <h2 id="detection-results" className="text-[15px] font-semibold">
          Detection results
        </h2>
        {results.length > 0 && (
          <span className="tabular text-sm text-muted-foreground">
            {met} of {results.length} met
          </span>
        )}
      </div>
      {failed ? (
        <p className="p-4 text-sm text-muted-foreground">Not available: this evidence record could not be loaded.</p>
      ) : !shown ? (
        <div className="p-4">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : !view ? (
        <p className="p-4 text-sm text-muted-foreground">Nothing can be shown while the document can&apos;t be read.</p>
      ) : results.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">This document holds no detection results.</p>
      ) : (
        <>
          {view.summary && <p className="border-b px-4 py-2.5 text-sm text-text-secondary">{view.summary}</p>}
          <ul>
            {results.map((result) => (
              <DetectionResult key={result.method} result={result} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** UC-6.5, 4a1: the evidence went at the end of its retention period (FR-10.5, M10); the summary stays. */
function EvidenceDeleted({ finding }: { finding: FindingDetail }) {
  const deleted = finding.evidence_deleted
  const when = deleted?.on
    ? ` on ${new Date(deleted.on).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
    : ""
  const period = deleted?.days ? ` (${deleted.days} days)` : ""
  return (
    <div className="flex flex-col items-center justify-center rounded-[10px] border bg-card px-6 py-16 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted" aria-hidden="true">
        <ArchiveX className="size-6 text-muted-foreground" />
      </span>
      <h2 className="mt-4 text-[15px] font-semibold">Evidence deleted</h2>
      <p className="mt-1 max-w-lg text-sm text-text-secondary">
        The evidence of this finding was deleted{when} at the end of its retention period{period}. The finding
        summary is kept.
      </p>
      <Button asChild variant="outline" className="mt-4 h-9">
        <Link href={`/findings/${finding.code}`}>View summary</Link>
      </Button>
    </div>
  )
}

/** What failed, and what the reader can do about it: try again, log in again, or nothing they can change. */
type Problem = { text: string; retry: boolean; login: boolean }

function problemOf(error: unknown, what: string): Problem {
  if (error instanceof ApiError && error.status === 401) {
    return { text: `${what} Your session has ended.`, retry: false, login: true }
  }
  if (error instanceof ApiError && error.status === 403) {
    return { text: `${what} Your role may not read it.`, retry: false, login: false }
  }
  return { text: what, retry: true, login: false }
}

function ProblemActions({ problem, onRetry }: { problem: Problem; onRetry: () => void }) {
  if (problem.login) {
    return (
      <Button asChild variant="outline" size="sm" className="h-9">
        <Link href="/login">Log in again</Link>
      </Button>
    )
  }
  return problem.retry ? (
    <Button variant="outline" size="sm" className="h-9" onClick={onRetry}>
      Try again
    </Button>
  ) : null
}

function LoadError({ problem, onRetry }: { problem: Problem; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-[10px] border bg-card p-5 text-sm">
      <p className="text-text-secondary">{problem.text}</p>
      <ProblemActions problem={problem} onRetry={onRetry} />
    </div>
  )
}

/** Screen 40: the evidence of a finding (UC-6.5 steps 4-5), written once and never changed. */
export function FindingEvidence({ code }: { code: string }) {
  const [finding, setFinding] = useState<FindingDetail | null>(null)
  const [records, setRecords] = useState<EvidenceItem[] | null>(null)
  const [score, setScore] = useState<Reproducibility | null>(null)
  const [scoreFailed, setScoreFailed] = useState<Problem | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [document, setDocument] = useState<EvidenceDetail | null>(null)
  const [documentFailed, setDocumentFailed] = useState<Problem | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState<Problem | null>(null)
  // The record the reader opened, so the page can say it opened (WCAG 4.1.3)
  const [opened, setOpened] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const centreRef = useRef<HTMLElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [scoreAttempt, setScoreAttempt] = useState(0)
  const [documentAttempt, setDocumentAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getFinding(code, controller.signal), listEvidence(code, controller.signal)])
      .then(([found, list]) => {
        setFinding(found)
        setRecords(list)
        // The attempt that found it first, as the design opens it: the finding's own first record
        const first = list.find((one) => one.finding === found.code) ?? list[0]
        setSelected((now) => now ?? (first ? keyOf(first) : null))
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
        else setFailed(problemOf(error, "The evidence of this finding could not be loaded."))
      })
    return () => controller.abort()
  }, [code, attempt])

  useEffect(() => {
    const controller = new AbortController()
    getReproducibility(code, controller.signal)
      .then(setScore)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setScoreFailed(problemOf(error, "The attempts behind the reproducibility score could not be loaded."))
        }
      })
    return () => controller.abort()
  }, [code, scoreAttempt])

  const record = records?.find((one) => keyOf(one) === selected) ?? null
  useEffect(() => {
    if (!record) return
    const controller = new AbortController()
    getEvidence(record.finding, record.number, controller.signal)
      .then(setDocument)
      .catch((error) => {
        if (!controller.signal.aborted) setDocumentFailed(problemOf(error, "This evidence record could not be loaded."))
      })
    return () => controller.abort()
  }, [record, documentAttempt])

  const open = useCallback((key: string) => {
    setDocumentFailed(null)
    setSelected(key)
    setOpened(key)
    // In one column the evidence sits under the whole list: bring it into view and give it the
    // keyboard, so pressing an attempt visibly opens it. Side by side, the keyboard stays in the list.
    requestAnimationFrame(() => {
      const list = listRef.current
      const centre = centreRef.current
      if (!list || !centre) return
      if (centre.getBoundingClientRect().top >= list.getBoundingClientRect().bottom - 1) {
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        centre.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" })
        centre.focus({ preventScroll: true })
      }
    })
  }, [])
  // A retry clears its own failure first, so the page shows it loading again
  const retry = () => {
    setFailed(null)
    setAttempt((n) => n + 1)
  }
  const retryScore = () => {
    setScoreFailed(null)
    setScoreAttempt((n) => n + 1)
  }
  const retryDocument = () => {
    setDocumentFailed(null)
    setDocumentAttempt((n) => n + 1)
  }

  if (notFound) {
    return (
      <EmptyState
        title="Finding not found"
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/findings">Back to findings</Link>
          </Button>
        }
      />
    )
  }
  if (failed) {
    return <LoadError problem={failed} onRetry={retry} />
  }
  if (!finding || records === null) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the evidence">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const shown = document && record && keyOf(document) === keyOf(record) ? document : null

  return (
    <div>
      <FindingHeader finding={finding} />
      <FindingTabs code={finding.code} active="evidence" evidence={records.length} />
      {finding.detection?.requires_confirmation &&
        (OPEN_STATUSES as readonly string[]).includes(finding.status) && <ConfirmationNotice judgeOnly={onlyJudgeSupports(finding.detection)} className="mb-5" />}

      {records.length === 0 ? (
        finding.evidence_deleted ? (
          <EvidenceDeleted finding={finding} />
        ) : (
          <EmptyState
            title="No evidence yet"
            description="Evidence appears after a run."
          />
        )
      ) : (
        // A container query: the columns follow the width the page has, not the window (as on Screen 38).
        // Narrower than three columns allow, the detection results go under the evidence, which keeps
        // its width; on a phone everything is one column.
        <div className="@container">
          <div className="grid items-start gap-5 @3xl:grid-cols-[280px_minmax(0,1fr)] @5xl:grid-cols-[280px_minmax(0,1fr)_320px]">
            <div ref={listRef} className="min-w-0 @3xl:row-span-2">
              <EvidenceList
                finding={finding}
                records={records}
                score={score}
                scoreFailed={scoreFailed}
                onRetryScore={retryScore}
                selected={selected}
                onOpen={open}
              />
            </div>
            <section
              ref={centreRef}
              tabIndex={-1}
              aria-label="The evidence of this attempt"
              className="min-w-0 scroll-mt-20 focus-visible:outline-none"
            >
              <p className="sr-only" aria-live="polite">
                {opened && shown && keyOf(shown) === opened ? `${shown.run.code}, attempt ${shown.attempt_no}: opened` : ""}
              </p>
              {documentFailed ? (
                <LoadError problem={documentFailed} onRetry={retryDocument} />
              ) : shown ? (
                <Document shown={shown} finding={finding.code} objective={finding.test} />
              ) : (
                <Skeleton className="h-64 w-full" />
              )}
            </section>
            <div className="min-w-0 @3xl:col-start-2 @5xl:col-start-3 @5xl:row-start-1">
              <Detection shown={documentFailed ? null : shown} failed={Boolean(documentFailed)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
