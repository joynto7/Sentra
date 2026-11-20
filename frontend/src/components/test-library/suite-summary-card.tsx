import { TriangleAlert } from "lucide-react"

import { type SuiteSummary, TARGET_TYPE_LABEL, aboutAttempts } from "@/lib/test-library"

/**
 * What a suite covers and the attempts one run needs (UC-4.4 step 4), with the warnings of
 * alternative 3a. Used by the suite builder (Screen 32) and the suite page.
 */
export function SuiteSummaryCard({ summary, live = false }: { summary: SuiteSummary | null; live?: boolean }) {
  const empty = !summary || summary.test_count === 0
  return (
    <section aria-labelledby="suite-summary-heading" className="space-y-3 rounded-[10px] border bg-card p-5">
      <h2 id="suite-summary-heading" className="text-[15px] font-semibold">
        Summary
      </h2>
      {empty ? (
        <p className="text-sm text-muted-foreground">Add tests to see what the suite covers.</p>
      ) : (
        <dl className="space-y-2.5 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Covers</dt>
            <dd className="font-mono text-[13px]">{summary.categories.join(", ")}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Target types</dt>
            <dd>{summary.target_types.map((t) => TARGET_TYPE_LABEL[t]).join(", ")}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Estimated attempts per run</dt>
            <dd>{aboutAttempts(summary.estimated_attempts)}</dd>
          </div>
        </dl>
      )}
      {summary?.warnings.map((warning) => (
        <p key={warning} className="flex items-start gap-2 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {warning}
        </p>
      ))}
      {live && (
        <p className="sr-only" aria-live="polite">
          {empty
            ? "The suite has no tests."
            : `${summary.test_count} tests, ${aboutAttempts(summary.estimated_attempts)} attempts per run.`}
        </p>
      )}
    </section>
  )
}
