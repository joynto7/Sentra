"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { FindingHeader } from "@/components/findings/finding-header"
import { FindingTabs } from "@/components/findings/finding-tabs"
import { EmptyState } from "@/components/layout/empty-state"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import {
  HISTORY_LABEL,
  type FindingDetail,
  type HistoryItem,
  getFinding,
  getHistory,
  saveTriage,
} from "@/lib/findings"
import { useCan } from "@/lib/permissions"
import { formatDateTime } from "@/lib/targets"

/** One entry of the history (UC-6.6 step 5): who did what, when, and what changed. */
export function HistoryEntry({ entry, code }: { entry: HistoryItem; code: string }) {
  const changed = entry.was && entry.became ? `${entry.was.replace(/_/g, " ")} → ${entry.became.replace(/_/g, " ")}` : ""
  return (
    <li className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:gap-4">
      <time dateTime={entry.at} className="tabular w-44 shrink-0 text-[13px] text-muted-foreground">
        {formatDateTime(entry.at)}
      </time>
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">
          <span className="font-medium">{HISTORY_LABEL[entry.kind] ?? entry.kind}</span>
          {changed && <span className="text-muted-foreground"> · {changed}</span>}
          {entry.user && <span className="text-muted-foreground"> · {entry.user}</span>}
          {entry.finding_related && (
            <>
              {" · "}
              <Link href={`/findings/${entry.finding_related}`} className="text-link underline underline-offset-2">
                {entry.finding_related}
              </Link>
            </>
          )}
        </p>
        {entry.text && <p className="mt-0.5 text-[13px] text-text-secondary">{entry.text}</p>}
        <p className="text-xs text-muted-foreground">
          {entry.by_sentra ? "Sentra" : entry.actor}
          {entry.run && ` · ${entry.run}`}
          {entry.finding !== code && ` · from ${entry.finding}, merged into this finding`}
        </p>
      </div>
    </li>
  )
}

/** A comment is a triage save with nothing but a comment (UC-6.6 step 4). */
export function CommentBox({ code, onSaved }: { code: string; onSaved: () => void }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    try {
      await saveTriage(code, { comment: text })
      setText("")
      toast.success("Comment added to the history.")
      onSaved()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <Label htmlFor="finding-comment">Add a comment</Label>
      <Textarea
        id="finding-comment"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        placeholder="What you found out, for everyone who reads this finding later."
      />
      <Button size="sm" onClick={add} disabled={busy || !text.trim()}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        Add comment
      </Button>
    </div>
  )
}

/** The Activity tab of a finding: its append-only history, and a comment box for analysts. */
export function FindingActivity({ code }: { code: string }) {
  const canTriage = useCan("triage_findings")
  const [finding, setFinding] = useState<FindingDetail | null>(null)
  const [history, setHistory] = useState<HistoryItem[] | null>(null)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(
    (signal?: AbortSignal) => {
      getHistory(code, signal)
        .then(setHistory)
        .catch(() => undefined)
    },
    [code],
  )

  useEffect(() => {
    getFinding(code)
      .then(setFinding)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
  }, [code])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

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
  if (!finding || !history) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the history">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div>
      <FindingHeader finding={finding} />
      <FindingTabs code={finding.code} active="activity" />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <section className="min-w-0 space-y-3 rounded-[10px] border bg-card p-5">
          <h2 className="text-[15px] font-semibold">History</h2>
          <p className="text-[13px] text-muted-foreground">
            Every decision about this finding, oldest first. The history is append-only, so a correction is a new
            entry (UC-6.6, quality requirement 5).
          </p>
          <ul className="flex flex-col">
            {history.map((entry) => (
              <HistoryEntry key={`${entry.finding}-${entry.number}`} entry={entry} code={finding.code} />
            ))}
          </ul>
        </section>

        <div className="min-w-0 space-y-5">
          {canTriage && (
            <section className="space-y-3 rounded-[10px] border bg-card p-5">
              <h2 className="text-[15px] font-semibold">Comment</h2>
              <CommentBox code={finding.code} onSaved={() => load()} />
            </section>
          )}
          {finding.merged_in.length > 0 && (
            <section className="space-y-2 rounded-[10px] border bg-card p-5">
              <h2 className="text-[15px] font-semibold">Merged duplicates</h2>
              <p className="text-[13px] text-muted-foreground">
                Their evidence and their history count as this finding&apos;s (FR-6.6).
              </p>
              <ul className="flex flex-wrap gap-2">
                {finding.merged_in.map((other) => (
                  <li key={other}>
                    <Link href={`/findings/${other}`} className="font-mono text-[13px] text-link hover:underline">
                      {other}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
