"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { CircleCheck, CircleX, Loader2, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  CONNECTION_FIX,
  type ConnectionTest,
  type Target,
  formatDateTime,
  getConnectionTest,
  listConnectionTests,
  startConnectionTest,
} from "@/lib/targets"
import { cn } from "@/lib/utils"

const POLL_MS = 1500
const MAX_POLLS = 40 // a minute; the worker ends a test itself, so this is only a guard

/**
 * The target's newest connection test, and starting a new one (UC-2.2 Test Target Connection).
 * Only workers reach targets, so the API answers at once and the page follows the test until it
 * has passed or failed.
 */
export function useConnectionTest(targetId: string) {
  const [test, setTest] = useState<ConnectionTest | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const polls = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    listConnectionTests(targetId, controller.signal)
      .then((tests) => setTest(tests[0] ?? null))
      .catch(() => undefined)
      .finally(() => !controller.signal.aborted && setLoading(false))
    return () => controller.abort()
  }, [targetId])

  // While a test is running, ask again until it has finished (steps 2 to 5).
  useEffect(() => {
    if (test?.status !== "running" || slow) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      polls.current += 1
      if (polls.current > MAX_POLLS) {
        setSlow(true)
        return
      }
      getConnectionTest(targetId, test.id, controller.signal).then(setTest).catch(() => undefined)
    }, POLL_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [test, targetId, slow])

  const start = useCallback(async () => {
    setBusy(true)
    setProblem(null)
    setSlow(false)
    polls.current = 0
    try {
      setTest(await startConnectionTest(targetId))
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "The test could not be started.")
    } finally {
      setBusy(false)
    }
  }, [targetId])

  return { test, loading, busy, problem, slow, start }
}

export type ConnectionState = ReturnType<typeof useConnectionTest>

/** "Test connection" (UC-2.2 step 1), for the roles that may test (FR-1.6). */
export function TestConnectionButton({
  target,
  state,
  className,
}: {
  target: Target
  state: ConnectionState
  className?: string
}) {
  const canTest = useCan("test_target_connections")
  if (!canTest || target.status === "archived") return null
  const running = state.test?.status === "running"
  return (
    <Button
      variant="outline"
      size="sm"
      className={className ?? "h-8"}
      disabled={state.busy || running}
      onClick={state.start}
    >
      {running ? "Testing…" : state.busy ? "Starting…" : "Test connection"}
    </Button>
  )
}

function FixLink({ target, test }: { target: Target; test: ConnectionTest }) {
  const label = CONNECTION_FIX[test.error_kind ?? ""]
  if (!label) return null
  return (
    <Button asChild variant="outline" size="sm" className="h-8">
      <Link href={`/targets/${target.id}/edit`}>{label}</Link>
    </Button>
  )
}

/**
 * The "Connection" card of Screen 20: when the target was last reached. The page owns the state,
 * so this card and the header's "Test connection" follow the same test.
 */
export function ConnectionSummary({ target, state }: { target: Target; state: ConnectionState }) {
  const { test, loading, problem, slow } = state
  const running = test?.status === "running"
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="text-sm">
        {loading ? (
          <span className="text-muted-foreground">Loading…</span>
        ) : running ? (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Sentra is sending one harmless request…
          </span>
        ) : test?.status === "passed" ? (
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <CircleCheck className="size-4 text-success" aria-hidden="true" />
            Last test passed {test.finished_at ? formatDateTime(test.finished_at) : ""}
            <span className="tabular text-muted-foreground">
              · HTTP {test.status_code} · {test.duration_ms} ms
            </span>
          </span>
        ) : test?.status === "failed" ? (
          <span className="inline-flex flex-wrap items-start gap-1.5 text-destructive">
            <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {test.error_message}
          </span>
        ) : (
          <span className="text-muted-foreground">Not tested yet.</span>
        )}
      </p>
      {slow && <p className="text-xs text-warning">This is taking longer than usual. Test again.</p>}
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      {test?.status === "failed" && <FixLink target={target} test={test} />}
    </div>
  )
}

/**
 * Screen 19's connection card: whether Sentra can reach the target, with its reply as plain text
 * (NFR-3.6) and what to do when it can't (UC-2.2, 3a, 3b and 4a).
 */
export function ConnectionTestCard({ target }: { target: Target }) {
  const state = useConnectionTest(target.id)
  const { test, loading, problem, slow } = state
  const running = test?.status === "running"
  const passed = test?.status === "passed"
  const failed = test?.status === "failed"

  return (
    <section
      aria-labelledby="connection-heading"
      className={cn(
        "rounded-[10px] border p-5",
        passed ? "border-success/40 bg-success/5" : failed ? "border-destructive/40 bg-card" : "bg-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="connection-heading" className="flex items-center gap-2 text-[15px] font-semibold">
          {passed && <CircleCheck className="size-5 text-success" aria-hidden="true" />}
          {failed && <CircleX className="size-5 text-destructive" aria-hidden="true" />}
          {running && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />}
          {loading
            ? "Connection"
            : running
              ? "Testing the connection…"
              : passed
                ? "Connection works"
                : failed
                  ? "Connection failed"
                  : "Connection not tested yet"}
        </h2>
        <TestConnectionButton target={target} state={state} />
      </div>

      <div aria-live="polite" className="mt-2 space-y-3">
        {running && (
          <p className="text-sm text-muted-foreground">
            Sentra is sending one harmless greeting to {target.endpoint_host}. This is never a security test.
          </p>
        )}
        {passed && (
          <>
            <p className="tabular text-sm text-text-secondary">
              HTTP {test.status_code} · {test.duration_ms} ms
              {test.reply_path ? ` · reply found at ${test.reply_path}` : ""}
            </p>
            {test.reply_excerpt && (
              <details className="group rounded-[7px] border bg-card">
                <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  <span className="group-open:hidden">Show test reply</span>
                  <span className="hidden group-open:inline">Hide test reply</span>
                </summary>
                {/* The target's own text: plain, masked, never active content (NFR-3.6). */}
                <p className="border-t px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-text-secondary">
                  {test.reply_excerpt}
                </p>
              </details>
            )}
          </>
        )}
        {failed && (
          <>
            <p className="text-sm">{test.error_message}</p>
            {test.unreadable_excerpt && (
              <div className="rounded-[7px] border bg-muted/40 p-3">
                <p className="text-xs font-medium">What Sentra could not read:</p>
                <p className="mt-1 font-mono text-xs break-words whitespace-pre-wrap text-text-secondary">
                  {test.unreadable_excerpt}
                </p>
              </div>
            )}
            <FixLink target={target} test={test} />
          </>
        )}
        {slow && (
          <p className="flex items-start gap-2 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            This is taking longer than usual. Start the test again.
          </p>
        )}
        {problem && <p className="text-sm text-destructive">{problem}</p>}
      </div>
    </section>
  )
}
