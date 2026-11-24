"use client"

import { HelpArea } from "@/components/wizard/disclosure"

/**
 * What the numbers on the Risk Dashboard are, for the scope and period on screen. It is a section
 * a person may open, never a step in the way: the definitions are the product's own (severity from
 * a fixed rating matrix, a score from confirmed open findings, coverage from runs that ended), and
 * the page does not call any of them a guarantee.
 */
export function MetricGuide({ scope, period, category, checked }: { scope: string; period: string; category: string | null; checked: string | null }) {
  return (
    <HelpArea
      title="What do these numbers mean?"
      className="mb-4"
      more={
        <ul className="space-y-2 text-[13px]">
          <li>
            <span className="font-medium text-foreground">Severity</span> says how serious one weakness is if it is real. It comes from a fixed rating
            matrix, so the same evidence always gives the same severity.
          </li>
          <li>
            <span className="font-medium text-foreground">Risk score</span> (0 to 100) compares applications by the open findings that were
            confirmed. Findings that still require confirmation are listed separately and are not counted. A low score means few or less serious
            weaknesses were found in what was tested.
          </li>
          <li>
            <span className="font-medium text-foreground">Coverage</span> says which categories were tested, from campaign runs that ended. A category that
            was never tested has no findings because nobody looked, not because it is safe.
          </li>
          <li>None of them is a compliance result or a promise that an application is safe. The link under the target&apos;s score shows how it is calculated.</li>
        </ul>
      }
    >
      <p>
        Shown now: {scope}, {period}
        {category ? `, ${category}` : ", all OWASP categories"}. {checked ? `Read at ${checked}; the page does not refresh by itself.` : "Not read yet."}
      </p>
    </HelpArea>
  )
}

/** How to read the coverage views, so that an empty cell or "no open findings" is never read as "safe". */
export function CoverageGuide() {
  return (
    <HelpArea
      title="How to read coverage"
      className="mb-4"
      more={
        <ul className="space-y-2 text-[13px]">
          <li><span className="font-medium text-foreground">Tested</span>: the application answered an attempt of a test of that category in a campaign run that ended.</li>
          <li><span className="font-medium text-foreground">Not tested since it changed</span>: it was tested, but the application changed afterwards, so the result may be out of date.</li>
          <li><span className="font-medium text-foreground">Never tested</span> or <span className="font-medium text-foreground">not testable</span> (ownership not verified): nothing was measured, so nothing can be said.</li>
          <li><span className="font-medium text-foreground">No open findings</span> means no weakness is open in what was tested. It is not a statement that the application is safe, and a category that was not tested cannot show one.</li>
        </ul>
      }
    >
      <p>Counts what was tested, not what is safe.</p>
    </HelpArea>
  )
}
