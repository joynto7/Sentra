"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { buildApps } from "@/components/risk/coverage-model"
import { CoveragePanel } from "@/components/risk/coverage-panel"
import { CoverageRadar, type Filter } from "@/components/risk/coverage-radar"
import { CoverageStory } from "@/components/risk/coverage-story"
import { TriageBoard } from "@/components/risk/triage-board"
import { PageHeader } from "@/components/layout/page-header"
import { CoverageGuide } from "@/components/risk/metric-guide"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type Coverage, getCoverage } from "@/lib/risk"
import { ATLAS_VERSION } from "@/lib/frameworks"

const FRAMEWORKS = [
  { value: "owasp", label: "OWASP Top 10 for LLM Applications 2025" },
  { value: "atlas", label: `MITRE ATLAS ${ATLAS_VERSION}` },
] as const

/**
 * Screen 43, Framework Coverage (UC-7.4): which OWASP categories and MITRE ATLAS techniques have
 * been tested for each target, where the gaps are, and what lies outside Sentra's tests. The radar
 * puts every application in the ring its open findings and gaps earn it; its drawer lists the
 * categories as text, and selecting one opens the panel with the threats, the suites and the way
 * to accept the gap. The board below sorts the categories by urgency and visibility.
 */
export function FrameworkCoverage({ initialTarget = "" }: { initialTarget?: string } = {}) {
  const [framework, setFramework] = useState<"owasp" | "atlas">("owasp")
  const [data, setData] = useState<Coverage | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<{ code: string; targetId: string } | null>(null)
  // The application the radar's drawer shows, and the one the triage board is narrowed to
  const [chosen, setChosen] = useState(initialTarget)
  const [laneTarget, setLaneTarget] = useState(initialTarget)
  const [vector, setVector] = useState("")
  // The radar's chips, kept here so that the guide can press one for the reader
  const [filter, setFilter] = useState<Filter>("all")

  useEffect(() => {
    const controller = new AbortController()
    // The whole fleet: the radar shows every application, and the lanes narrow it themselves.
    getCoverage(new URLSearchParams({ framework }), controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [framework, attempt])

  const again = useCallback(() => setAttempt((n) => n + 1), [])
  const apps = useMemo(() => (data ? buildApps(data) : []), [data])
  // The radar opens its drawer on the application picked, and closes it when it is picked again.
  const shown = apps.some((app) => app.id === chosen) ? chosen : ""

  /** The four steps of the story, done on this page. Each answers with what it did. */
  function tryStep(step: number): string | null {
    const verified = apps.filter((app) => app.verified)
    // The riskiest application: the most open findings in the red centre first
    const riskiest = [...verified].sort((a, b) => (b.ring === "critical" ? 1 : 0) - (a.ring === "critical" ? 1 : 0) || b.open - a.open)[0]
    if (!riskiest) return null
    const toRadar = () => document.getElementById("coverage-radar")?.scrollIntoView({ behavior: "smooth", block: "start" })
    const code = riskiest.rows.find((row) => row.standing.kind === "open")?.code ?? riskiest.rows[0]?.code
    if (step === 0) {
      setFramework("owasp")
      setFilter("critical")
      toRadar()
      const lit = apps.filter((app) => app.ring === "critical").length
      return `Critical only is on: ${lit} of ${apps.length} applications stay lit.`
    }
    if (step === 1) {
      setFilter("all")
      setChosen(riskiest.id)
      toRadar()
      return `${riskiest.name} is selected. Its categories are listed beside the radar.`
    }
    if (step === 2) {
      if (!code) return null
      setChosen(riskiest.id)
      setSelected({ code, targetId: riskiest.id })
      return `The panel of ${code} is open: its threats, its test suites and the way to accept a gap.`
    }
    if (!code) return null
    setSelected(null)
    setChosen(riskiest.id)
    setLaneTarget(riskiest.id)
    setVector(code)
    window.setTimeout(() => document.getElementById("board")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
    return `The board shows ${riskiest.name} and ${code} is chosen. “Show these findings” under it opens the list.`
  }

  return (
    <>
      <PageHeader title="Framework Coverage" description="OWASP and MITRE ATLAS categories tested." />

      {data && apps.length > 0 && <CoverageStory className="mb-4" onTry={tryStep} />}

      <CoverageGuide />

      <Tabs
        value={framework}
        onValueChange={(value) => {
          setFramework(value as "owasp" | "atlas")
          setVector("")
        }}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            {FRAMEWORKS.map((one) => (
              <TabsTrigger key={one.value} value={one.value}>
                {one.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent
          value={framework}
          className="mt-0 space-y-4 rounded-[10px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription className="flex items-center justify-between gap-4">
                The coverage could not be loaded.
                <Button variant="outline" size="sm" onClick={again}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {!data && !error && (
            <div className="space-y-2" role="status" aria-label="Loading the coverage">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
          )}

          {data && apps.length === 0 && (
            <p className="rounded-[10px] border bg-card p-4 text-sm text-text-secondary">
              No target is registered yet, so there is nothing to cover.
            </p>
          )}

          {data && apps.length > 0 && (
            <>
              <CoverageRadar
                apps={apps}
                selected={shown}
                filter={filter}
                onFilter={setFilter}
                onSelect={setChosen}
                onOpenCategory={(code, targetId) => setSelected({ code, targetId })}
                onFocusLanes={(id) => {
                  setLaneTarget(id)
                  document.getElementById("board")?.scrollIntoView({ behavior: "smooth", block: "start" })
                }}
              />
              <TriageBoard
                data={data}
                framework={framework}
                apps={apps}
                target={laneTarget}
                vector={vector}
                onTarget={setLaneTarget}
                onVector={setVector}
              />
              <p className="text-[13px] text-muted-foreground">Tested means an attempt ran in an ended campaign run.</p>
            </>
          )}
        </TabsContent>
      </Tabs>

      <CoveragePanel
        code={selected?.code ?? null}
        targetId={selected?.targetId ?? null}
        framework={framework}
        onClose={() => setSelected(null)}
        onChanged={again}
      />
    </>
  )
}
