"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, EyeOff, FileWarning, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  ATTEMPT_VERDICT_LABEL,
  type AttemptVerdict,
  FINDING_VERDICT_LABEL,
  type FindingVerdict,
  type Matched,
  type ToLabel,
  blindSample,
  labelAttempt,
  labelFinding,
  unmatchedFindings,
} from "@/lib/lab"

const KEYS: Record<string, AttemptVerdict> = {
  s: "successful",
  u: "unsuccessful",
  "?": "unsure",
  "/": "unsure", // the key "?" sits on, for a keyboard that needs Shift for it
}

const BUTTONS: { verdict: AttemptVerdict; hint: string }[] = [
  { verdict: "successful", hint: "S" },
  { verdict: "unsuccessful", hint: "U" },
  { verdict: "unsure", hint: "?" },
]

/**
 * One attempt of the blind sample, with the three judgements (UC-11.5 step 3). It is mounted
 * again for every attempt, so the note starts empty — or with what this analyst wrote before —
 * without an effect that copies state.
 *
 * The letter shortcuts work only while focus is inside this card, which is how WCAG 2.1.4 allows
 * single-character shortcuts without a way to turn them off.
 */
function LabellingCard({
  item,
  busy,
  onLabel,
  onMove,
}: {
  item: ToLabel
  busy: boolean
  onLabel: (verdict: AttemptVerdict, note: string) => void
  onMove: (to: number) => void
}) {
  const [note, setNote] = useState(item.note ?? "")
  const [writing, setWriting] = useState(Boolean(item.note))
  const card = useRef<HTMLDivElement>(null)

  // The card takes focus as each attempt arrives, so the shortcuts keep working while labelling.
  useEffect(() => card.current?.focus(), [])

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Inside the note, or inside the tool calls a keyboard scrolls, the keys are the user's.
    const typing =
      event.target instanceof HTMLElement && event.target.closest('textarea, input, [role="region"]')
    if (typing || event.metaKey || event.ctrlKey || event.altKey || busy) return
    const verdict = KEYS[event.key.toLowerCase()]
    if (verdict) {
      event.preventDefault()
      onLabel(verdict, note)
    } else if (event.key === "ArrowLeft" && item.place > 1) {
      event.preventDefault()
      onMove(item.place - 1)
    } else if (event.key === "ArrowRight" && item.place < item.total) {
      event.preventDefault()
      onMove(item.place + 1)
    }
  }

  return (
    <div
      ref={card}
      tabIndex={0}
      role="group"
      aria-label={`Attempt ${item.place} of ${item.total}`}
      onKeyDown={onKeyDown}
      className="mx-auto max-w-3xl rounded-[10px] border bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="border-b px-5 py-4">
        <p className="tabular text-sm font-medium" role="status">
          Attempt {item.place} of {item.total}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Lab target: {item.target_name}</span>
          {item.category && <Badge variant="outline">{item.category}</Badge>}
          <span className="font-mono">{item.test_code}</span>
          {item.verdict && (
            <Badge variant="secondary">You said: {ATTEMPT_VERDICT_LABEL[item.verdict]}</Badge>
          )}
        </p>
        {item.objective && <p className="mt-2 text-sm">Objective: {item.objective}</p>}
      </div>

      <div className="space-y-4 px-5 py-4">
        <div>
          <h2 className="text-xs font-medium text-muted-foreground">What was sent</h2>
          <p className="mt-1 rounded-[7px] bg-muted/50 p-3 text-sm whitespace-pre-wrap">
            {item.message}
          </p>
        </div>
        <div>
          <h2 className="text-xs font-medium text-muted-foreground">What the lab target replied</h2>
          <p className="mt-1 rounded-[7px] bg-muted/50 p-3 text-sm whitespace-pre-wrap">
            {item.reply ?? "It sent no reply."}
          </p>
        </div>
        {item.tool_calls && (
          <div>
            <h2 className="text-xs font-medium text-muted-foreground">Tool calls — simulated</h2>
            {/* A long line of JSON scrolls sideways on a narrow screen, so it is a region a
                keyboard can reach and scroll (axe: scrollable-region-focusable). */}
            <pre
              role="region"
              aria-label="Tool calls of this attempt"
              tabIndex={0}
              className="mt-1 overflow-x-auto rounded-[7px] bg-muted/50 p-3 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {item.tool_calls}
            </pre>
          </div>
        )}
      </div>

      <div className="border-t px-5 py-4">
        <h2 className="text-sm font-medium">Did this attempt succeed?</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {BUTTONS.map(({ verdict, hint }) => (
            <Button
              key={verdict}
              variant={item.verdict === verdict ? "default" : "outline"}
              className="h-12 justify-center"
              disabled={busy}
              onClick={() => onLabel(verdict, note)}
            >
              {ATTEMPT_VERDICT_LABEL[verdict]}
              <span className="ml-1.5 text-xs opacity-70">({hint})</span>
            </Button>
          ))}
        </div>

        {writing ? (
          <div className="mt-3">
            <label htmlFor="label-note" className="text-xs font-medium text-muted-foreground">
              Note (kept with your label)
            </label>
            <Textarea
              id="label-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={2000}
              className="mt-1"
              placeholder="Why this attempt is hard to judge, for example."
            />
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="mt-2 px-0" onClick={() => setWriting(true)}>
            Add a note
          </Button>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            S, U or ? to label · ← → to move, while this card has focus
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || item.place <= 1}
              onClick={() => onMove(item.place - 1)}
            >
              <ArrowLeft aria-hidden="true" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || item.place >= item.total}
              onClick={() => onMove(item.place + 1)}
            >
              Next
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** One finding that matched no documented weakness (UC-11.5 step 2 and 2a). */
function FindingRow({
  row,
  busy,
  onLabel,
}: {
  row: Matched
  busy: boolean
  onLabel: (verdict: FindingVerdict) => void
}) {
  return (
    <li className="rounded-[10px] border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            <span className="tabular">F-{String(row.finding_number).padStart(3, "0")}</span>{" "}
            {row.title}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="outline">{row.category}</Badge>
            <span>{row.component}</span>
            {row.label && <Badge variant="secondary">{FINDING_VERDICT_LABEL[row.label]}</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={row.label === "false_positive" ? "default" : "outline"}
            size="sm"
            disabled={busy}
            onClick={() => onLabel("false_positive")}
          >
            False positive
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onLabel("undocumented")}>
            Real, undocumented → document it
          </Button>
        </div>
      </div>
    </li>
  )
}

/**
 * Screen 68: the analyst's own judgements of a benchmark run (FR-11.4, UC-11.5 steps 2-3). The
 * attempts are served without any detection result, because a reference that has seen Sentra's
 * verdict is no reference (NFR-9.5).
 */
export function BenchmarkLabelling({ code }: { code: string }) {
  const [item, setItem] = useState<ToLabel | null>(null)
  const [findings, setFindings] = useState<Matched[] | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  // What the last label did, said in the page: kept only after the server answered, or not kept
  const [saveNote, setSaveNote] = useState<{ ok: boolean; text: string } | null>(null)
  const canLabel = useCan("use_security_lab") !== false
  usePageCrumbs([{ label: code, href: `/lab/benchmarks/${code}` }, { label: "Labelling" }])

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([blindSample(code, undefined, controller.signal), unmatchedFindings(code, controller.signal)])
      .then(([next, open]) => {
        setItem(next)
        setFindings(open)
        setLoaded(true)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [code])

  const move = useCallback(
    async (to: number) => {
      setBusy(true)
      try {
        setItem(await blindSample(code, to))
      } catch {
        toast.error("That attempt could not be loaded.")
      } finally {
        setBusy(false)
      }
    },
    [code],
  )

  async function label(verdict: AttemptVerdict, note: string) {
    if (!item) return
    setBusy(true)
    setSaveNote(null)
    try {
      const next = await labelAttempt(code, item.attempt_id, verdict, note)
      setItem(next)
      setSaveNote({ ok: true, text: `Saved: attempt ${item.place} is marked ${verdict}. ${next ? `${next.labelled} of ${next.total} attempts are labelled.` : "Every attempt of the sample is labelled."}` })
    } catch (failed) {
      const why = failed instanceof ApiError ? failed.message : "That label could not be saved."
      setSaveNote({ ok: false, text: `Attempt ${item.place} was not labelled, because it could not be saved: ${why} It is still unlabelled. Try again.` })
      toast.error(why)
    } finally {
      setBusy(false)
    }
  }

  async function judge(row: Matched, verdict: FindingVerdict) {
    setBusy(true)
    try {
      const left = await labelFinding(code, row.finding_id, verdict)
      setFindings(left)
      toast.success(
        verdict === "undocumented"
          ? "Documented as a weakness of the lab target. The results are measured against the new version of its list."
          : "Recorded as a false positive.",
      )
    } catch (failed) {
      toast.error(failed instanceof ApiError ? failed.message : "That label could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  const total = item?.total ?? 0
  const labelled = item?.labelled ?? 0
  const percent = total > 0 ? Math.round((labelled / total) * 100) : 0
  // The tab counts the findings that matched nothing, judged or not; what is still outstanding
  // is on the results page, under "These results are incomplete".
  const unmatched = (findings ?? []).length

  return (
    <div className="min-w-0">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{code} — Labelling</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your judgement, which detection is measured against.</p>
      </div>

      {!canLabel && (
        <Alert role="status" className="mb-4">
          <EyeOff aria-hidden="true" />
          <AlertDescription>
            Only a Security Analyst labels a benchmark run. You can read what has been labelled so
            far.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>This benchmark run could not be loaded.</AlertDescription>
        </Alert>
      )}

      {!loaded && !error && (
        <div className="space-y-4" role="status" aria-label="Loading the sample">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      )}

      {loaded && (
        <Tabs defaultValue="attempts">
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger value="attempts">
              Blind attempt sample ({labelled} of {total} labelled)
            </TabsTrigger>
            <TabsTrigger value="findings">Unmatched findings ({unmatched})</TabsTrigger>
          </TabsList>

          <TabsContent
            value="attempts"
            className="mt-4 rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {total > 0 && (
              <div className="mx-auto mb-4 max-w-3xl">
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Attempts labelled"
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(percent, 1)}%` }}
                  />
                </div>
                <p className="tabular mt-1 text-xs text-muted-foreground">{percent} % labelled</p>
              </div>
            )}

            <p className="mx-auto mb-4 flex max-w-3xl items-start gap-2 text-sm text-muted-foreground">
              <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Detection results are hidden so that your labels stay independent.
            </p>

            {saveNote && (
              <p
                role={saveNote.ok ? "status" : "alert"}
                aria-live="polite"
                className={saveNote.ok ? "text-[13px] text-muted-foreground" : "rounded-[7px] border border-destructive/40 bg-destructive/5 p-3 text-[13px] text-destructive"}
              >
                {saveNote.text}
              </p>
            )}

            {item ? (
              <LabellingCard
                key={item.attempt_id}
                item={item}
                busy={busy || !canLabel}
                onLabel={(verdict, note) => void label(verdict, note)}
                onMove={(to) => void move(to)}
              />
            ) : total > 0 ? (
              <EmptyState
                title="Every attempt of the sample is labelled"
                description="Labels feed the results page."
                action={
                  <Button asChild>
                    <Link href={`/lab/benchmarks/${code}/results`}>See the results</Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="There is nothing to label yet"
              />
            )}
          </TabsContent>

          <TabsContent
            value="findings"
            className="mt-4 rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <p className="mb-4 flex items-start gap-2 text-sm text-muted-foreground">
              <FileWarning className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              These findings match nothing in their lab target&apos;s documented list. Documenting one
              adds it to that list as a new version, and the results are measured against it.
            </p>
            {findings && findings.length > 0 ? (
              <ul className="space-y-2" aria-label="Findings that matched no documented weakness">
                {findings.map((row) => (
                  <FindingRow
                    key={row.finding_id}
                    row={row}
                    busy={busy || !canLabel}
                    onLabel={(verdict) => void judge(row, verdict)}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Every finding matched a documented weakness"
                description="Nothing here needs your judgement."
              />
            )}
          </TabsContent>
        </Tabs>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        <Link
          href={`/lab/benchmarks/${code}`}
          className="text-primary underline underline-offset-2"
        >
          Back to {code}
        </Link>
      </p>
    </div>
  )
}
