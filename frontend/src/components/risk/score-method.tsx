"use client"

import { useEffect, useState } from "react"

import { SEVERITY_LABEL, type Severity } from "@/components/sentra/severity-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BAND_LABEL, type RiskMethod, getRiskMethod } from "@/lib/risk"

/** The likelihood a column of the matrix stands for, from the hardest to the easiest to reach. */
const LIKELIHOOD = [1, 2, 3, 4]

/** One of the reproducibility steps of the rules, as a percentage. */
const share = (method: RiskMethod, step: number) =>
  `${Math.round(Number(method.severity.reproducibility[step]?.from ?? 0) * 100)} %`

/**
 * "How is the risk score calculated?" (Screen 42): the rating matrix of FR-7.1 (M7) and the bands of
 * FR-7.2 (M7), read from `/api/v1/risk/method`, which returns the rules the code itself uses. Nothing
 * here is written twice, so the page can never drift from the calculation (NFR-4.2).
 */
export function ScoreMethod() {
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState<RiskMethod | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open || method) return
    const controller = new AbortController()
    getRiskMethod(controller.signal)
      .then((found) => {
        setMethod(found)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [open, method])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="link" className="h-6 p-0 text-[13px] font-normal">
          How is the risk score calculated?
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>How Sentra rates a finding and scores a target</DialogTitle>
          <DialogDescription>
            Every severity and every score follows these rules, so the same evidence always gives the same
            result.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">The rules could not be loaded. Close this and try again.</p>}
        {!method && !error && (
          <div className="space-y-3" role="status" aria-label="Loading the rules">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {method && (
          <div className="space-y-6 text-sm">
            <section aria-labelledby="method-impact">
              <h3 id="method-impact" className="text-[15px] font-semibold">
                1. Impact — how bad what happened is
              </h3>
              <ul className="mt-2 space-y-1.5">
                {method.severity.impact.map((level) => (
                  <li key={level.consequence} className="flex gap-2">
                    <span className="tabular text-muted-foreground">{level.level}</span>
                    <span>
                      <span className="font-medium">{level.label}.</span>{" "}
                      <span className="text-text-secondary">{level.sentence}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="method-likelihood">
              <h3 id="method-likelihood" className="text-[15px] font-semibold">
                2. Likelihood — how easily and how reliably it can be reached
              </h3>
              <ul className="mt-2 space-y-1.5">
                {method.severity.exploitability.map((level) => (
                  <li key={level.level} className="flex gap-2">
                    <span className="tabular text-muted-foreground">{level.level > 0 ? level.level : "−"}</span>
                    <span className="text-text-secondary">{level.sentence}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-text-secondary">
                A weakness that is reproduced less often counts as harder to reach: at or above{" "}
                {share(method, 0)} the likelihood stays as it is, from {share(method, 1)} it drops by one
                level, and below that by two.
              </p>
            </section>
            <section aria-labelledby="method-matrix">
              <h3 id="method-matrix" className="text-[15px] font-semibold">
                3. The two together give the severity
              </h3>
              <Table className="mt-2">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Impact ↓ · Likelihood →</TableHead>
                    {LIKELIHOOD.map((level) => (
                      <TableHead key={level} scope="col" className="tabular">
                        {level}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...method.severity.matrix].reverse().map((row) => (
                    <TableRow key={row.impact}>
                      <TableCell className="tabular font-medium">{row.impact}</TableCell>
                      {row.likelihood.map((severity: Severity, index) => (
                        <TableCell key={LIKELIHOOD[index]}>{SEVERITY_LABEL[severity]}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
            <section aria-labelledby="method-bands">
              <h3 id="method-bands" className="text-[15px] font-semibold">
                4. The target&apos;s score follows its worst finding
              </h3>
              <p className="mt-2 text-text-secondary">
                The highest severity among the findings that count sets the band; every further finding at that
                severity moves the score up inside the band, never out of it. A finding that still requires
                confirmation is shown beside the score and not counted.
              </p>
              <ul className="mt-2 space-y-1">
                {method.bands.map((band) => (
                  <li key={band.band} className="flex gap-2">
                    <span className="tabular w-16 text-muted-foreground">
                      {band.from}–{band.to}
                    </span>
                    <span>
                      {BAND_LABEL[band.band]} — its worst counted finding is {SEVERITY_LABEL[band.severity].toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
