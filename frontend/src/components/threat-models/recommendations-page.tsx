"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CircleAlert, CircleCheck, Plus, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { AcceptGapDialog } from "@/components/threat-models/accept-gap-dialog"
import { CHIP } from "@/components/threat-models/badges"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type Recommendations,
  type SuiteRecommendation,
  type ThreatGap,
  acceptThreatGap,
  getRecommendations,
  longDate,
  plural,
  saveSuiteSelection,
} from "@/lib/threat-models"
import { cn } from "@/lib/utils"

const FAILED = "Sentra could not load the recommendations."

const problemOf = (caught: unknown) =>
  caught instanceof ApiError ? { code: caught.code, message: caught.message } : { code: "error", message: FAILED }

/** The suites a person picked, in the order the API returned them. */
const selectedCodes = (data: Recommendations) => data.suites.filter((s) => s.selected).map((s) => s.code)

function SuiteItem({
  suite,
  checked,
  editable,
  onToggle,
}: {
  suite: SuiteRecommendation
  checked: boolean
  editable: boolean
  onToggle: (on: boolean) => void
}) {
  return (
    <li className={cn("flex items-start gap-3 border-t px-4 py-3", checked && "bg-accent/40")}>
      <Checkbox
        id={`suite-${suite.code}`}
        checked={checked}
        disabled={!editable}
        onCheckedChange={(on) => onToggle(on === true)}
        className="mt-1"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor={`suite-${suite.code}`} className="text-sm font-medium">
            {suite.name}
          </label>
          {suite.origin === "custom" && (
            <span className={cn(CHIP, "border-border-strong text-text-secondary")}>Custom</span>
          )}
          {suite.top_risk > 0 && (
            <span className={cn(CHIP, suite.top_risk >= 15 ? "border-destructive/50 text-destructive" : "border-border")}>
              Highest risk {suite.top_risk}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="tabular">{suite.tests}</span> {suite.tests === 1 ? "test" : "tests"} · about{" "}
          <span className="tabular">{suite.attempts}</span> attempts per run · {suite.purpose}
        </p>
        {suite.threats.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Threats ${suite.name} addresses`}>
            {suite.threats.map((threat) => (
              <li key={threat.number} className={cn(CHIP, "h-auto max-w-full border-border py-1 font-normal whitespace-normal")}>
                <span className="text-text-secondary">{threat.title}</span>
                <span className="tabular text-muted-foreground">(risk {threat.risk})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

function GapCard({
  gap,
  editable,
  onAccept,
}: {
  gap: ThreatGap
  editable: boolean
  onAccept: () => void
}) {
  return (
    <li
      className={cn(
        "rounded-md border p-3",
        gap.accepted ? "border-border bg-muted/40" : "border-warning/60 bg-warning/10",
      )}
    >
      <p className="text-sm font-medium">{gap.title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {gap.component_name} · <span className="font-mono">{gap.owasp.map((o) => o.code).join(", ")}</span> · risk{" "}
        <span className="tabular">{gap.risk}</span>
      </p>
      {gap.out_of_scope && (
        <p className="mt-1 text-xs text-text-secondary">
          Its category lies outside application testing, so no test of the library covers it.
        </p>
      )}
      {gap.accepted ? (
        <p className="mt-2 text-xs text-text-secondary">
          <span className="font-medium">Accepted</span> by {gap.accepted.accepted_by ?? "a person"} on{" "}
          {longDate(gap.accepted.accepted_at)} — {gap.accepted.reason}
        </p>
      ) : (
        editable && (
          <div className="mt-2 flex flex-wrap gap-2">
            {!gap.out_of_scope && (
              <Button asChild size="sm" variant="outline" className="h-8">
                <Link href="/test-library/new">Create custom test</Link>
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8" onClick={onAccept}>
              Accept gap with reason
            </Button>
          </div>
        )
      )}
    </li>
  )
}

/** Screen 27: the test suites that address the threats of the target's approved threat model,
 * and the threats no test covers (UC-3.3, FR-3.4). Saving them makes them the default for the
 * target's new campaigns. */
export function RecommendationsPage({ targetId }: { targetId: string }) {
  const canManage = useCan("manage_threat_models")
  const [data, setData] = useState<Recommendations | null>(null)
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [others, setOthers] = useState(false)
  const [accepting, setAccepting] = useState<ThreatGap | null>(null)
  const [busy, setBusy] = useState<"save" | "gap" | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")

  function show(found: Recommendations) {
    setData(found)
    setChosen(selectedCodes(found))
    setLoadError(null)
  }

  useEffect(() => {
    const controller = new AbortController()
    getRecommendations(targetId, controller.signal)
      .then(show)
      .catch((caught) => {
        if (!controller.signal.aborted) setLoadError(problemOf(caught))
      })
    return () => controller.abort()
  }, [targetId])

  usePageCrumbs(
    data ? [{ label: data.target.name, href: `/threat-models/${targetId}` }, { label: "Recommendations" }] : [],
  )

  const archived = data?.target.status === "archived"
  const editable = Boolean(canManage && data && !archived)
  const recommended = useMemo(() => data?.suites.filter((s) => s.recommended) ?? [], [data])
  const rest = useMemo(() => data?.suites.filter((s) => !s.recommended) ?? [], [data])
  const picked = useMemo(() => (data?.suites ?? []).filter((s) => chosen.includes(s.code)), [data, chosen])
  const totals = picked.reduce(
    (sum, suite) => ({ tests: sum.tests + suite.tests, attempts: sum.attempts + suite.attempts }),
    { tests: 0, attempts: 0 },
  )
  const saved = data?.selection?.current ? data.selection : null
  const changed =
    data !== null && (chosen.length !== selectedCodes(data).length || chosen.some((code) => !selectedCodes(data).includes(code)))

  function toggle(code: string, on: boolean) {
    setSaveError(null)
    setChosen((current) => (on ? [...current, code] : current.filter((item) => item !== code)))
  }

  async function handle(caught: unknown) {
    if (caught instanceof ApiError && caught.code === "newer_version") {
      toast.error(caught.message)
      const found = await getRecommendations(targetId).catch(() => null)
      if (found) show(found)
      return
    }
    if (caught instanceof ApiError && caught.details?.length) {
      setSaveError(caught.details.map((detail) => detail.message).join(" "))
      return
    }
    toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.")
  }

  async function save() {
    if (!data) return
    setBusy("save")
    setSaveError(null)
    try {
      show(await saveSuiteSelection(targetId, data.version.version, chosen))
      toast.success(`Saved as the default for new campaigns of ${data.target.name}.`)
      setAnnouncement("The suites are saved as the default for new campaigns.")
    } catch (caught) {
      await handle(caught)
    } finally {
      setBusy(null)
    }
  }

  async function accept(threat: number, reason: string) {
    if (!data) return
    setBusy("gap")
    try {
      show(await acceptThreatGap(targetId, data.version.version, threat, reason))
      setAccepting(null)
      toast.success("The gap is recorded with your reason.")
      setAnnouncement("The gap is recorded with your reason.")
    } catch (caught) {
      await handle(caught)
    } finally {
      setBusy(null)
    }
  }

  // The page keeps its heading while it loads and when it has nothing to show.
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-[1200px]">
        <h1 className="mb-5 text-2xl font-semibold tracking-tight">Recommended test suites</h1>
        {loadError ? (
          <EmptyState
            title={loadError.code === "no_approved_threat_model" ? "No approved threat model yet" : "Recommendations not available"}
            description={loadError.message}
            action={
              <Button asChild variant="outline">
                <Link href={`/threat-models/${targetId}`}>Open the threat model</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-3" aria-busy="true" aria-label="Loading the recommendations">
            <Skeleton className="h-6 w-96" />
            <Skeleton className="h-96 w-full" />
          </div>
        )}
      </div>
    )
  }

  const { version, target } = data
  const gaps = data.gaps

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Recommended test suites</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          For {target.name}, based on{" "}
          {/* Inside a muted sentence, a link needs more than its colour (WCAG 1.4.1). */}
          <Link
            href={`/threat-models/${targetId}?version=${version.version}`}
            className="text-link underline underline-offset-4"
          >
            threat model v{version.version}
          </Link>{" "}
          {version.approved_at
            ? `(approved ${longDate(version.approved_at)}${version.approved_by ? ` by ${version.approved_by}` : ""})`
            : "(approved)"}
          .
        </p>
      </div>

      {archived && (
        <Alert className="mb-4">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>This target is archived, so its suites can only be read.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-labelledby="suites-heading" className="min-w-0 self-start rounded-[10px] border bg-card">
          <div className="px-4 pt-4 pb-3">
            <h2 id="suites-heading" className="text-[15px] font-semibold">
              Test suites
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ordered by the highest risk they address. Sentra ticks the smallest set that covers every threat it
              can; change it as you see fit.
            </p>
          </div>

          {recommended.length === 0 ? (
            <p className="border-t px-4 py-8 text-center text-sm text-muted-foreground">
              No suite of the library addresses a threat of this version.
            </p>
          ) : (
            <ul aria-label="Recommended test suites">
              {recommended.map((suite) => (
                <SuiteItem
                  key={suite.code}
                  suite={suite}
                  checked={chosen.includes(suite.code)}
                  editable={editable}
                  onToggle={(on) => toggle(suite.code, on)}
                />
              ))}
            </ul>
          )}

          {others && rest.length > 0 && (
            <>
              <p className="border-t bg-muted/60 px-4 py-2 text-xs font-medium text-muted-foreground">
                Other suites — they address no threat of this version
              </p>
              <ul aria-label="Other test suites">
                {rest.map((suite) => (
                  <SuiteItem
                    key={suite.code}
                    suite={suite}
                    checked={chosen.includes(suite.code)}
                    editable={editable}
                    onToggle={(on) => toggle(suite.code, on)}
                  />
                ))}
              </ul>
            </>
          )}

          {saveError && (
            <div className="border-t px-4 pt-3">
              <Alert variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {plural(picked.length, "suite", "suites")} selected · <span className="tabular">{totals.tests}</span>{" "}
              {totals.tests === 1 ? "test" : "tests"} · about <span className="tabular">{totals.attempts}</span> attempts
              per run
            </p>
            {editable && (
              <div className="flex flex-wrap gap-2">
                {rest.length > 0 && (
                  <Button variant="outline" className="h-9" onClick={() => setOthers((open) => !open)} aria-expanded={others}>
                    <Plus aria-hidden="true" />
                    {others ? "Hide the other suites" : "Add another suite"}
                  </Button>
                )}
                <Button
                  className="h-9 hover:bg-primary-hover"
                  onClick={() => void save()}
                  disabled={busy !== null || !changed}
                  aria-describedby={!changed ? "save-suites-hint" : undefined}
                >
                  {busy === "save" ? "Saving…" : "Save as default for new campaigns"}
                </Button>
                {!changed && (
                  <p id="save-suites-hint" className="w-full text-xs text-muted-foreground">
                    Tick or untick a suite first; then the choice can be saved.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        <div className="space-y-4 self-start">
          <section aria-labelledby="coverage-heading" className="rounded-[10px] border bg-card p-5">
            <h2 id="coverage-heading" className="text-[15px] font-semibold">
              Coverage
            </h2>
            <p className="mt-2 text-sm">
              <span className="tabular text-xl font-semibold">
                {data.threats_covered} of {data.threats_total}
              </span>
              <span className="block text-muted-foreground">threats have a test in the library</span>
            </p>
            {gaps.length === 0 ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-success">
                <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>Every threat of this version has a test.</span>
              </p>
            ) : (
              <>
                <p className="mt-4 flex items-start gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{plural(gaps.length, "threat has", "threats have")} no test</span>
                </p>
                <ul className="mt-2 space-y-2">
                  {gaps.map((gap) => (
                    <GapCard key={gap.number} gap={gap} editable={editable} onAccept={() => setAccepting(gap)} />
                  ))}
                </ul>
              </>
            )}
          </section>

          {saved && (
            <section aria-label="Saved selection" className="rounded-[10px] border bg-card p-5 text-sm">
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                <span>
                  New campaigns of {target.name} start with {plural(saved.suites.length, "suite", "suites")}, saved by{" "}
                  {saved.saved_by ?? "a person"} on {longDate(saved.saved_at)}.
                </span>
              </p>
              {saved.uncovered.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {plural(saved.uncovered.length, "threat", "threats")} stayed without a test when it was saved.
                </p>
              )}
            </section>
          )}

          {!editable && canManage !== undefined && !archived && (
            <p className="px-1 text-sm text-muted-foreground">
              Only a Security Analyst can change the default suites.
            </p>
          )}
        </div>
      </div>

      <AcceptGapDialog
        gap={accepting}
        busy={busy === "gap"}
        onClose={() => setAccepting(null)}
        onAccept={(threat, reason) => void accept(threat, reason)}
      />
    </div>
  )
}
