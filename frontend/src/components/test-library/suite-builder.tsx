"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { toast } from "sonner"

import { FormField } from "@/components/auth/form-field"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { FilterSelect } from "@/components/sentra/filter-select"
import { SeverityBadge } from "@/components/sentra/severity-badge"
import { useSession } from "@/components/session-provider"
import { SuiteSummaryCard } from "@/components/test-library/suite-summary-card"
import { groupByCategory } from "@/components/test-library/suite-view"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  CATEGORIES,
  type SuiteDetail,
  type SuiteSummary,
  TARGET_TYPE_LABEL,
  type TestSummary,
  createSuite,
  getSuite,
  listAllTests,
  saveSuiteVersion,
  suiteSummary,
} from "@/lib/test-library"
import { cn } from "@/lib/utils"

const SUITES = { label: "Test Suites", href: "/test-library?tab=suites" }
const FIELD_ORDER = ["name", "purpose", "tests", "reason"]
type Row = { code: string; name: string; category: string; severity: TestSummary["severity"]; target_types: string[]; retired?: boolean }

const types = (row: Row) => (row.target_types.length === 3 ? "All types" : row.target_types.map((t) => TARGET_TYPE_LABEL[t]).join(", "))

/**
 * Screen 32, the test suite builder: UC-4.4 Create Test Suite and UC-4.5 Update Test Suite. Tests
 * are added and removed with buttons (no dragging); the summary card shows what the suite covers
 * and the attempts one run needs before saving.
 */
export function SuiteBuilder({ code, from, test }: { code?: string; from?: string; test?: string }) {
  const router = useRouter()
  const organization = useSession().organization?.name ?? "your organization"
  const canBuild = useCan("manage_test_suites")
  const editing = !!code
  const [library, setLibrary] = useState<TestSummary[] | null>(null)
  const [original, setOriginal] = useState<SuiteDetail | null>(null)
  const [ready, setReady] = useState(!code && !from)
  const [loadError, setLoadError] = useState<"not_found" | "failed" | null>(null)
  const [name, setName] = useState("")
  const [purpose, setPurpose] = useState("")
  const [tests, setTests] = useState<string[]>(test ? [test] : [])
  const [reason, setReason] = useState("")
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("")
  const [summary, setSummary] = useState<SuiteSummary | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(!!test)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [announcement, setAnnouncement] = useState("")
  const leaving = useRef(false)
  const suitePanel = useRef<HTMLDivElement>(null)
  const suiteHeading = useRef<HTMLHeadingElement>(null)
  const backTo = code ? `/test-library/suites/${code}` : "/test-library?tab=suites"

  usePageCrumbs(
    code
      ? [SUITES, { label: original?.name ?? code, href: `/test-library/suites/${code}` }, { label: "Edit" }]
      : [SUITES, { label: "New Test Suite" }],
  )

  useEffect(() => {
    listAllTests()
      .then(setLibrary)
      .catch(() => setLoadError("failed"))
  }, [])

  // Edit: the current version. Duplicate (?from=CODE, UC-4.5 1a): a copy to adapt.
  useEffect(() => {
    const source = code ?? from
    if (!source) return
    getSuite(source)
      .then((suite) => {
        if (code) setOriginal(suite)
        setName(code ? suite.name : `Copy of ${suite.name}`.slice(0, 80))
        setPurpose(suite.purpose)
        // A copy starts without retired tests; an edit keeps them until the user removes them.
        setTests(code ? suite.test_codes : suite.tests.filter((t) => t.found && !t.retired).map((t) => t.code))
        if (from) setTouched(true)
        setReady(true)
      })
      .catch((error) => setLoadError(error instanceof ApiError && error.status === 404 ? "not_found" : "failed"))
  }, [code, from])

  // The summary card, from the API whenever the tests change (UC-4.4 step 4).
  useEffect(() => {
    if (!ready || canBuild !== true) return
    let active = true
    const timer = setTimeout(() => {
      suiteSummary(tests)
        .then((result) => active && setSummary(result))
        .catch(() => undefined)
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [tests, ready, canBuild])

  useEffect(() => {
    if (!touched) return
    const warn = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [touched])

  // A test in the suite may be retired since: then only the suite's own record knows it.
  const rows = useMemo(() => {
    const found = new Map<string, Row>(library?.map((t) => [t.code, t]))
    for (const t of original?.tests ?? []) {
      if (t.found && !found.has(t.code)) found.set(t.code, t)
    }
    return found
  }, [library, original])
  const chosen = tests.map((c) => rows.get(c)).filter((row): row is Row => !!row)
  const text = search.trim().toLowerCase()
  const shown = (library ?? []).filter(
    (t) =>
      (!category || t.category === category) &&
      (!text || t.name.toLowerCase().includes(text) || t.code.toLowerCase().includes(text)),
  )

  function add(row: Row) {
    setTests((current) => [...current, row.code])
    setTouched(true)
    setErrors((current) => {
      const next = { ...current }
      delete next.tests
      return next
    })
    setAnnouncement(`${row.code} added. ${tests.length + 1} tests in the suite.`)
  }

  function remove(row: Row, button?: HTMLButtonElement) {
    // The removed row's button disappears from the suite panel: the focus goes to the next one.
    const buttons = Array.from(suitePanel.current?.querySelectorAll<HTMLButtonElement>("button[data-remove]") ?? [])
    const position = button ? buttons.indexOf(button) : -1
    setTests((current) => current.filter((c) => c !== row.code))
    setTouched(true)
    setAnnouncement(`${row.code} removed. ${tests.length - 1} tests in the suite.`)
    if (position >= 0) {
      requestAnimationFrame(() => {
        const left = Array.from(suitePanel.current?.querySelectorAll<HTMLButtonElement>("button[data-remove]") ?? [])
        ;(left[position] ?? left[position - 1] ?? suiteHeading.current)?.focus()
      })
    }
  }

  function focusField(found: Record<string, string>) {
    const first = FORM_FIELD_IDS[FIELD_ORDER.find((field) => found[field]) ?? ""]
    if (first) requestAnimationFrame(() => document.getElementById(first)?.focus())
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    const found: Record<string, string> = {}
    if (!name.trim()) found.name = "Enter a name."
    if (!purpose.trim()) found.purpose = "Describe the purpose of the suite."
    if (!tests.length) found.tests = "Add at least one test. A suite can't be empty."
    if (code && reason.trim().length < 3) found.reason = "Describe the reason for the change."
    setErrors(found)
    if (Object.keys(found).length) {
      setFormError("Some fields need attention. Each problem is shown next to its field.")
      focusField(found)
      return
    }
    setBusy(true)
    try {
      const input = { name, purpose, tests }
      const saved = code ? await saveSuiteVersion(code, input, reason.trim()) : await createSuite(input)
      leaving.current = true
      toast.success(code ? `Version ${saved.version} of ${saved.name} saved` : `${saved.name} saved as version 1`, {
        description: code ? "Campaigns use it from their next run." : `Visible only to ${organization}.`,
      })
      router.push(`/test-library/suites/${saved.code}`)
    } catch (error) {
      setBusy(false)
      if (!(error instanceof ApiError)) {
        setFormError("Something went wrong. Try again.")
        return
      }
      const fields: Record<string, string> = {}
      for (const detail of error.details ?? []) {
        fields[detail.field] = fields[detail.field] ? `${fields[detail.field]} ${detail.message}` : detail.message
      }
      setErrors(fields)
      setFormError(error.code === "validation_error" ? "Some fields need attention. Each problem is shown next to its field." : error.message)
      focusField(fields)
    }
  }

  if (canBuild === false) {
    return (
      <EmptyState
        title="Only Security Analysts build test suites"
        description="You can browse the test suites. Ask a Security Analyst of your organization to build or change one."
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/test-library?tab=suites">Back to the test suites</Link>
          </Button>
        }
      />
    )
  }
  if (loadError === "not_found") {
    return (
      <EmptyState
        title="Test suite not found"
        description="It doesn't exist, or it belongs to another organization."
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/test-library?tab=suites">Back to the test suites</Link>
          </Button>
        }
      />
    )
  }
  if (loadError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>The suite builder could not be loaded. Reload the page to try again.</AlertDescription>
      </Alert>
    )
  }
  if (original && (original.origin === "built_in" || original.status === "archived")) {
    // UC-4.5, 1a: built-in suites are read-only; an archived suite can't be changed either.
    return (
      <EmptyState
        title={original.status === "archived" ? "This suite is archived" : "Built-in suites are read-only"}
        description={`To adapt ${original.name}, duplicate it as a suite of ${organization}.`}
        action={
          <Button asChild className="h-9 hover:bg-primary-hover">
            <Link href={`/test-library/suites/new?from=${encodeURIComponent(original.code)}`}>Duplicate as custom suite</Link>
          </Button>
        }
      />
    )
  }
  if (!library || !ready || canBuild === undefined) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the suite builder">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const nextVersion = (original?.version ?? 0) + 1

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{code ? "Edit test suite" : "New Test Suite"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {original ? (
            <>
              <span className="font-mono">{original.code}</span> · version {original.version} is current; saving creates
              version {nextVersion}.
            </>
          ) : (
            `Saved as version 1 and visible only to ${organization}.`
          )}
        </p>
      </div>

      {formError && (
        <Alert variant="destructive" role="alert" className="mb-5">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      {editing && (
        <Alert className="mb-5">
          <AlertDescription>
            Changes apply from the next campaign run that uses this suite. Earlier runs keep the version they used.
          </AlertDescription>
        </Alert>
      )}

      <form id="test-suite" onSubmit={save} noValidate className="space-y-5">
        <section aria-labelledby="suite-about-heading" className="space-y-4 rounded-[10px] border bg-card p-6">
          <h2 id="suite-about-heading" className="text-[15px] font-semibold">
            About the suite
          </h2>
          <FormField id="suite-name" label="Name" error={errors.name}>
            <Input
              id="suite-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setTouched(true)
              }}
              maxLength={80}
              autoComplete="off"
              className="h-9 sm:max-w-lg"
              aria-invalid={!!errors.name || undefined}
              aria-describedby={errors.name ? "suite-name-error" : undefined}
            />
          </FormField>
          <FormField id="suite-purpose" label="Purpose" error={errors.purpose}>
            <Textarea
              id="suite-purpose"
              value={purpose}
              onChange={(e) => {
                setPurpose(e.target.value)
                setTouched(true)
              }}
              maxLength={300}
              rows={2}
              placeholder="Fast regression for the CI/CD security gate"
              aria-invalid={!!errors.purpose || undefined}
              aria-describedby={errors.purpose ? "suite-purpose-error" : undefined}
            />
          </FormField>
        </section>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
          <section aria-labelledby="library-heading" className="min-w-0 space-y-3 rounded-[10px] border bg-card p-5">
            <h2 id="library-heading" className="text-[15px] font-semibold">
              Test Library
            </h2>
            <div className="flex flex-wrap gap-2">
              <label className="relative block min-w-48 flex-1">
                <span className="sr-only">Search the Test Library</span>
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  id="library-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or ID"
                  className="h-9 w-full rounded-[7px] border border-input bg-card pr-3 pl-8 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                />
              </label>
              <FilterSelect label="Category" value={category} onChange={setCategory} options={CATEGORIES} />
            </div>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {shown.length} of {library.length} tests
            </p>
            <ul className="max-h-[560px] divide-y overflow-y-auto rounded-[10px] border">
              {shown.map((row) => {
                const inSuite = tests.includes(row.code)
                return (
                  <li key={row.code} className={cn("flex items-center gap-3 px-3 py-2", inSuite && "bg-accent/40")}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono text-xs">{row.code}</span>
                        <span className="text-sm">{row.name}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{row.category}</span>
                        <SeverityBadge severity={row.severity} />
                        <span>{types(row)}</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant={inSuite ? "ghost" : "outline"}
                      size="sm"
                      className="h-8 shrink-0"
                      aria-label={`${inSuite ? "Remove" : "Add"} ${row.code} ${row.name}`}
                      onClick={() => (inSuite ? remove(row) : add(row))} // the button stays, and so does the focus
                    >
                      {inSuite ? "Remove" : "Add"}
                    </Button>
                  </li>
                )
              })}
              {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No tests match.</li>}
            </ul>
          </section>

          <section aria-labelledby="in-suite-heading" className="min-w-0 space-y-3 rounded-[10px] border bg-card p-5">
            <h2 id="in-suite-heading" ref={suiteHeading} tabIndex={-1} className="text-[15px] font-semibold outline-none">
              In this suite ({tests.length} {tests.length === 1 ? "test" : "tests"})
            </h2>
            {errors.tests && (
              <p id="tests-error" className="text-xs text-destructive">
                {errors.tests}
              </p>
            )}
            <div id="suite-tests" ref={suitePanel} className="space-y-3">
              {chosen.length === 0 ? (
                <p className="rounded-[10px] border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                  No tests yet. Add tests from the Test Library.
                </p>
              ) : (
                groupByCategory(chosen).map((group) => (
                  <div key={group.category} className="space-y-1.5">
                    <h3 className="text-xs font-semibold text-muted-foreground">{group.label}</h3>
                    <ul className="divide-y rounded-[10px] border">
                      {group.tests.map((row) => (
                        <li key={row.code} className="flex items-center gap-3 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-mono text-xs">{row.code}</span>
                              <span className="text-sm">{row.name}</span>
                            </div>
                            <p className={cn("text-xs", row.retired ? "text-warning" : "text-muted-foreground")}>
                              {row.retired ? "Retired: skipped in future runs" : types(row)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 shrink-0"
                            data-remove=""
                            aria-label={`Remove ${row.code} ${row.name}`}
                            onClick={(e) => remove(row, e.currentTarget)}
                          >
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="space-y-5 xl:sticky xl:top-6">
            <SuiteSummaryCard summary={summary} live />
          </div>
        </div>

        {editing && (
          <section aria-labelledby="suite-reason-heading" className="space-y-4 rounded-[10px] border bg-card p-6">
            <h2 id="suite-reason-heading" className="text-[15px] font-semibold">
              Reason for this change
            </h2>
            <FormField id="suite-reason" label="Reason" error={errors.reason}>
              <Textarea
                id="suite-reason"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value)
                  setTouched(true)
                }}
                maxLength={200}
                rows={2}
                placeholder="Added the tenant isolation test"
                aria-invalid={!!errors.reason || undefined}
                aria-describedby={errors.reason ? "suite-reason-error suite-reason-help" : "suite-reason-help"}
              />
              <p id="suite-reason-help" className="text-xs text-muted-foreground">
                Shown with version {nextVersion} in the version history.
              </p>
            </FormField>
          </section>
        )}
      </form>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex justify-end gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <Button type="button" variant="outline" className="h-9" onClick={() => (touched ? setConfirmLeave(true) : router.push(backTo))}>
          Cancel
        </Button>
        <Button type="submit" form="test-suite" className="h-9 hover:bg-primary-hover" disabled={busy}>
          {busy ? "Saving…" : `Save as version ${nextVersion}`}
        </Button>
      </div>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Discard your changes?" : "Discard this suite?"}</DialogTitle>
            <DialogDescription>{editing ? "The suite keeps its current version." : "Nothing has been saved yet."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-9">
                Keep editing
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className="h-9"
              onClick={() => {
                leaving.current = true
                router.push(backTo)
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Where the focus goes for each field with a problem.
const FORM_FIELD_IDS: Record<string, string> = {
  name: "suite-name",
  purpose: "suite-purpose",
  tests: "library-search",
  reason: "suite-reason",
}
