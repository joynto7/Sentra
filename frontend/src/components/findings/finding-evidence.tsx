"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CircleCheck, CircleX, Lock, Send, Wrench } from "lucide-react"

import { FindingHeader } from "@/components/findings/finding-header"
import { FindingTabs } from "@/components/findings/finding-tabs"
import { EmptyState } from "@/components/layout/empty-state"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import {
  type EvidenceDetail,
  type EvidenceItem,
  type EvidenceResult,
  type FindingDetail,
  getEvidence,
  getFinding,
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

function clock(iso: string | null | undefined): string {
  if (!iso) return ""
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/** The target's own text: plain, masked, never rendered as active content (NFR-3.6). */
function TargetText({ text }: { text: string }) {
  return (
    <p className="rounded-[7px] border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap text-text-secondary">
      {text}
    </p>
  )
}

function Step({
  icon,
  title,
  at,
  children,
}: {
  icon: React.ReactNode
  title: string
  at: string
  children?: React.ReactNode
}) {
  return (
    <li className="relative pl-7">
      <span className="absolute top-0.5 left-0 text-muted-foreground" aria-hidden="true">
        {icon}
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="tabular text-xs text-muted-foreground">{at}</span>
      </div>
      <div className="mt-1.5 space-y-2">{children}</div>
    </li>
  )
}

/** UC-6.5 step 5 and NFR-9.4: what each detection method found, the judge with its reasoning. */
function DetectionResult({ result }: { result: EvidenceResult }) {
  const met = result.outcome === "met"
  return (
    <li className="space-y-1.5 rounded-[7px] border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {met ? (
          <CircleCheck className="size-4 text-success" aria-hidden="true" />
        ) : (
          <CircleX className="size-4 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="text-sm font-medium">{METHOD_LABEL[result.method] ?? result.method}</span>
        <span className="text-xs text-muted-foreground">
          {result.role} · {met ? "met" : result.outcome.replace("_", " ")}
        </span>
      </div>
      <p className="text-sm text-text-secondary">{result.summary}</p>
      {result.checks.length > 0 && (
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
        <div className="space-y-1 border-t pt-2">
          {result.reasoning && <p className="text-xs text-text-secondary">{result.reasoning}</p>}
          <p className="tabular text-xs text-muted-foreground">
            {result.confidence ? `Confidence ${result.confidence} · ` : ""}
            {result.model ?? "unknown model"}
            {result.deployment ? ` (${result.deployment})` : ""}
            {result.instructions_version ? ` · instructions v${result.instructions_version}` : ""}
          </p>
        </div>
      )}
    </li>
  )
}

/** Screen 40: the evidence of a finding (UC-6.5 steps 4-5), written once and never changed. */
export function FindingEvidence({ code }: { code: string }) {
  const [finding, setFinding] = useState<FindingDetail | null>(null)
  const [records, setRecords] = useState<EvidenceItem[] | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [document, setDocument] = useState<EvidenceDetail | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getFinding(code, controller.signal)
      .then(setFinding)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
    listEvidence(code, controller.signal)
      .then((found) => {
        setRecords(found)
        setSelected(found[0]?.number ?? null)
      })
      .catch(() => setRecords([]))
    return () => controller.abort()
  }, [code])

  useEffect(() => {
    if (selected === null) return
    const controller = new AbortController()
    getEvidence(code, selected, controller.signal)
      .then(setDocument)
      .catch(() => undefined)
    return () => controller.abort()
  }, [code, selected])

  const open = useCallback((number: number) => setSelected(number), [])

  if (notFound) {
    return (
      <EmptyState
        title="Finding not found"
        description="It doesn't exist, or it belongs to another organization."
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/findings">Back to findings</Link>
          </Button>
        }
      />
    )
  }
  if (!finding || records === null) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the evidence">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const shown = document && document.number === selected ? document : null
  const content = shown?.content ?? null

  return (
    <div>
      <FindingHeader finding={finding} />
      <FindingTabs code={finding.code} active="evidence" />

      {records.length === 0 ? (
        <EmptyState
          title="No evidence yet"
          description="A finding gets its evidence when a campaign run meets the success condition of its test."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr_320px]">
          <nav aria-label="Evidence records" className="min-w-0">
            <h2 className="mb-2 text-[15px] font-semibold">Evidence ({records.length})</h2>
            <ul className="space-y-1">
              {records.map((record) => (
                <li key={record.number}>
                  <button
                    type="button"
                    onClick={() => open(record.number)}
                    aria-current={record.number === selected ? "true" : undefined}
                    className={cn(
                      "w-full rounded-[7px] border px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      record.number === selected ? "border-primary bg-primary/5" : "hover:bg-muted",
                    )}
                  >
                    <span className="block font-mono text-[13px]">{record.run.code}</span>
                    <span className="block text-xs text-muted-foreground">
                      Attempt {record.attempt_no} ·{" "}
                      {record.kind === "judge_verdict" ? "the LLM judge's answer" : "the attempt"}
                    </span>
                    <span className="block text-xs text-muted-foreground">{formatDateTime(record.recorded_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section aria-label="The evidence of this attempt" className="min-w-0 space-y-4">
            {!shown ? (
              <Skeleton className="h-64 w-full" />
            ) : !content ? (
              <p className="rounded-[10px] border bg-card p-5 text-sm text-muted-foreground">
                The stored document could not be read: {shown.integrity.status === "missing" ? "it is missing." : "it was changed."}
              </p>
            ) : (
              <>
                <div className="rounded-[10px] border bg-card p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-[15px] font-semibold">
                      {content.campaign_run} · {content.kind === "judge_verdict" ? "the LLM judge's answer" : "the attempt"}
                    </h2>
                    <span
                      className={cn(
                        "text-sm font-medium",
                        content.detection.verdict.outcome === "met" ? "text-success" : "text-muted-foreground",
                      )}
                    >
                      {content.detection.verdict.outcome === "met" ? "Met" : "Not met"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="font-mono text-xs">{content.test.code}</span> v{content.test.version} ·{" "}
                    {content.test.name}
                  </p>
                  {content.test.success_condition && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Success condition: {content.test.success_condition}
                    </p>
                  )}
                </div>

                <ol className="space-y-5 rounded-[10px] border bg-card p-5">
                  <Step
                    icon={<Send className="size-4" aria-hidden="true" />}
                    title={`Attempt ${content.attempt.number} sent`}
                    at={clock(content.attempt.sent_at)}
                  >
                    {content.attempt.message && <TargetText text={content.attempt.message} />}
                    <p className="text-xs text-muted-foreground">
                      Conversation {content.attempt.conversation ?? "–"} · template {content.attempt.template ?? "–"}
                      {content.attempt.variant ? `, message ${content.attempt.variant}` : ""}
                    </p>
                  </Step>

                  {Array.isArray(content.tool_calls) && content.tool_calls.length > 0 && (
                    <Step
                      icon={<Wrench className="size-4" aria-hidden="true" />}
                      title="Tool calls"
                      at={clock(content.reply?.received_at)}
                    >
                      <TargetText text={JSON.stringify(content.tool_calls, null, 2)} />
                    </Step>
                  )}

                  {content.reply && (
                    <Step
                      icon={<CircleCheck className="size-4" aria-hidden="true" />}
                      title="The target's reply"
                      at={clock(content.reply.received_at)}
                    >
                      <TargetText text={content.reply.text} />
                      <p className="tabular text-xs text-muted-foreground">
                        HTTP {content.reply.status_code} · {content.reply.duration_ms} ms ·{" "}
                        {content.reply.length ?? 0} characters
                        {content.reply.truncated ? " (only the first 64 KB are kept)" : ""} · shown as plain text,
                        personal data was masked before storage
                      </p>
                    </Step>
                  )}
                </ol>

                <div className="flex flex-wrap items-center gap-2 rounded-[10px] border bg-card p-4 text-sm">
                  <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>Stored {formatDateTime(shown.recorded_at)}</span>
                  <span className="text-muted-foreground">
                    · SHA-256 <span className="font-mono text-xs">{shown.checksum.slice(0, 8)}…{shown.checksum.slice(-4)}</span>
                  </span>
                  <span
                    className={cn(
                      "font-medium",
                      shown.integrity.status === "unchanged" ? "text-success" : "text-destructive",
                    )}
                  >
                    · {shown.integrity.status === "unchanged" ? "unchanged" : shown.integrity.status}
                  </span>
                  <span className="text-muted-foreground">
                    · read-only · {shown.size} bytes in the {shown.stored_in === "database" ? "database" : "object storage"}
                  </span>
                </div>
              </>
            )}
          </section>

          <section aria-label="Detection results" className="min-w-0">
            <h2 className="mb-2 text-[15px] font-semibold">Detection results</h2>
            {content ? (
              <>
                <p className="mb-2 text-sm text-text-secondary">{content.detection.verdict.summary}</p>
                <ul className="space-y-2">
                  {content.detection.results.map((result) => (
                    <DetectionResult key={result.method} result={result} />
                  ))}
                </ul>
              </>
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </section>
        </div>
      )}
    </div>
  )
}
