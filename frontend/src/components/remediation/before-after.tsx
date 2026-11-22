"use client"

import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Figures } from "@/lib/remediation"

const LINE = "var(--chart-line, var(--foreground))"
const WIDTH = 560
const HEIGHT = 210
const PAD = { left: 38, right: 12, top: 16, bottom: 44 }

type Pair = {
  /** What is measured, and the unit its counts are in. */
  label: string
  unit: string
  before: { successes: number; attempts: number; rate: number | null; words: string } | null
  after: { successes: number; attempts: number; rate: number | null; words: string } | null
}

/** The two measurements of FR-8.5 as pairs, so the chart and the table read the same numbers. */
export function pairs(figures: Figures): Pair[] {
  const attack = figures.attack_success
  const normal = figures.normal_use
  return [
    {
      label: "Attack success",
      unit: "repeated attempts",
      before: {
        successes: attack.before_successes,
        attempts: attack.before_attempts,
        rate: attack.before_rate,
        words: attack.before_words,
      },
      after: {
        successes: attack.after_successes,
        attempts: attack.after_attempts,
        rate: attack.after_rate,
        words: attack.after_words,
      },
    },
    {
      label: "Normal use affected",
      unit: "requests of normal use",
      // Before the fix nothing of the policy could affect normal use, so there is no "before"
      // bar to draw: the comparison is the share after it, against none.
      before: { successes: 0, attempts: normal.total, rate: normal.total ? 0 : null, words: normal.total ? `0 of ${normal.total} requests (0 %)` : "not measured" },
      after: {
        successes: normal.affected,
        attempts: normal.total,
        rate: normal.affected_rate,
        words: normal.affected_words,
      },
    },
  ]
}

/**
 * The paired bars of Screen 51: before and after, on one scale of 0 to 100 % so that the two
 * halves of the comparison can be read against each other, with every value printed on its bar
 * (NFR-4.3) and the "after" bar hatched, so the two never depend on colour (WCAG 1.4.1).
 */
function Chart({ rows }: { rows: Pair[] }) {
  const titleId = useId()
  const groupWidth = (WIDTH - PAD.left - PAD.right) / rows.length
  const barWidth = Math.min(54, groupWidth / 3.2)
  const floor = HEIGHT - PAD.bottom
  const height = (rate: number | null) =>
    rate === null ? 0 : (rate / 100) * (floor - PAD.top - 12)
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-56 w-full"
      role="img"
      aria-labelledby={titleId}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={titleId}>
        {rows
          .map(
            (row) =>
              `${row.label}: before the fix ${row.before?.words ?? "not measured"}, after the fix ${
                row.after?.words ?? "not measured"
              }`,
          )
          .join(". ")}
      </title>
      {[0, 50, 100].map((mark) => (
        <g key={mark}>
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={floor - height(mark)}
            y2={floor - height(mark)}
            stroke="var(--border)"
            strokeDasharray={mark === 0 ? undefined : "2 4"}
          />
          <text x={4} y={floor - height(mark) + 4} className="fill-muted-foreground text-[11px]">
            {mark} %
          </text>
        </g>
      ))}
      {rows.map((row, index) => {
        const left = PAD.left + index * groupWidth
        const bar = (
          side: Pair["before"],
          offset: number,
          name: string,
          hatched: boolean,
        ) => {
          if (side === null || side.rate === null) {
            return (
              <text
                x={left + offset + barWidth / 2}
                y={floor - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                not measured
              </text>
            )
          }
          const tall = height(side.rate)
          return (
            <>
              <rect
                x={left + offset}
                y={floor - tall}
                width={barWidth}
                height={Math.max(tall, 1)}
                fill={hatched ? "url(#after-bars)" : LINE}
                stroke={LINE}
                strokeWidth={hatched ? 1 : 0}
              />
              <text
                x={left + offset + barWidth / 2}
                y={floor - tall - 6}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-medium"
              >
                {side.successes} of {side.attempts}
              </text>
              <text
                x={left + offset + barWidth / 2}
                y={floor + 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {name}
              </text>
            </>
          )
        }
        const gap = (groupWidth - barWidth * 2 - 8) / 2
        return (
          <g key={row.label}>
            {bar(row.before, gap, "Before", false)}
            {bar(row.after, gap + barWidth + 8, "After", true)}
            <text
              x={left + groupWidth / 2}
              y={floor + 32}
              textAnchor="middle"
              className="fill-foreground text-[11px] font-medium"
            >
              {row.label}
            </text>
          </g>
        )
      })}
      <defs>
        {/* "After" is hatched, so the two bars of a pair differ without colour (WCAG 1.4.1). */}
        <pattern
          id="after-bars"
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="4" height="4" fill="var(--card)" />
          <line x1="0" y1="0" x2="0" y2="4" stroke={LINE} strokeWidth="1.5" />
        </pattern>
      </defs>
    </svg>
  )
}

/**
 * The chart of UC-8.7 with the table that holds the same figures (quality requirement 2 and
 * NFR-4.3): rates over repeated attempts, never a single outcome, and every rate with the counts
 * it came from.
 */
export function BeforeAfter({ figures }: { figures: Figures }) {
  const [asTable, setAsTable] = useState(false)
  const rows = pairs(figures)
  return (
    <section aria-labelledby="comparison" className="min-w-0 rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <h2 id="comparison" className="text-[15px] font-semibold">
          Before and after
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          aria-pressed={asTable}
          onClick={() => setAsTable((on) => !on)}
        >
          {asTable ? "View as chart" : "View as table"}
        </Button>
      </div>
      <div className="p-4">
        {asTable ? (
          <Table
            container={{
              tabIndex: 0,
              role: "group",
              "aria-label": "Before and after, as a table",
              className:
                "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            }}
          >
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="text-xs">
                  What was measured
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  Before the fix
                </TableHead>
                <TableHead scope="col" className="text-xs">
                  After the fix
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="text-[13px]">
                    {row.label}
                    <span className="block text-xs text-muted-foreground">over {row.unit}</span>
                  </TableCell>
                  <TableCell className="tabular text-[13px]">
                    {row.before?.words ?? "not measured"}
                  </TableCell>
                  <TableCell className="tabular text-[13px]">
                    {row.after?.words ?? "not measured"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Chart rows={rows} />
        )}
        <p className="mt-2 text-[13px] text-muted-foreground">
          Both halves are rates over repeated attempts, measured with the same test and the same
          number of repetitions, so they can be read against each other.
        </p>
      </div>
    </section>
  )
}
