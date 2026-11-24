"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Cpu,
  Database,
  Layers,
  type LucideIcon,
  MessageSquareText,
  Plus,
  RefreshCw,
  ScrollText,
  Sparkles,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { useSession } from "@/components/session-provider"
import { TargetTabs } from "@/components/targets/target-tabs"
import { AddThreatDialog } from "@/components/threat-models/add-threat-dialog"
import { NewerVersionDialog } from "@/components/threat-models/newer-version-dialog"
import { RemoveThreatDialog } from "@/components/threat-models/remove-threat-dialog"
import { ModelJourney } from "@/components/threat-models/model-journey-view"
import { type ReviewCounts, ReviewPanel } from "@/components/threat-models/review-panel"
import { type ThreatForm, atlasOf } from "@/components/threat-models/threat-fields"
import { type ShownThreat, ThreatItem } from "@/components/threat-models/threat-item"
import { ThreatMap } from "@/components/threat-models/threat-map"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  ATLAS_TECHNIQUES,
  type FrameworkRef,
  KIND_GROUP,
  KIND_ORDER,
  OWASP_CATEGORIES,
  type Threat,
  type ThreatComponent,
  type ThreatEdit,
  type ThreatModelPage,
  type ThreatNew,
  TYPE_PHRASE,
  type VersionComparison,
  type VersionDetail,
  approveThreatModel,
  compareVersions,
  generateThreatModel,
  getThreatModel,
  jobActive,
  longDate,
  plural,
  saveThreatModelVersion,
} from "@/lib/threat-models"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 20
const POLL_MS = 3000

/** The analyst's changes that aren't saved yet (UC-3.2 step 3), by threat number. */
type Pending = {
  edits: Record<number, ThreatEdit>
  removals: Record<number, string>
  restores: number[]
  additions: (ThreatNew & { key: string })[]
}
const NONE: Pending = { edits: {}, removals: {}, restores: [], additions: [] }

const count = (p: Pending) =>
  Object.keys(p.edits).length + Object.keys(p.removals).length + p.restores.length + p.additions.length

const owaspRefs = (codes: string[]): FrameworkRef[] =>
  codes.map((code) => {
    const known = OWASP_CATEGORIES.find((c) => c.code === code)
    return { code, name: known?.name ?? null, in_scope: known?.inScope ?? true }
  })

const atlasRef = (code: string | null): FrameworkRef | null =>
  code ? { code, name: ATLAS_TECHNIQUES.find((t) => t.code === code)?.name ?? null, in_scope: true } : null

const componentKey = (kind: string, name: string) => `${kind}::${name}`

const problemOf = (caught: unknown) =>
  caught instanceof ApiError
    ? { code: caught.code, message: caught.message }
    : { code: "error", message: "Sentra could not load the threat model." }

/** The stored threats with the unsaved changes applied; new ones first, removed ones last. */
function shownThreats(threats: Threat[], pending: Pending): ShownThreat[] {
  const stored = threats.map((t): ShownThreat => {
    const row: ShownThreat = {
      key: String(t.number),
      number: t.number,
      title: t.title,
      component_kind: t.component_kind,
      component_name: t.component_name,
      owasp: t.owasp,
      atlas: t.atlas,
      likelihood: t.likelihood,
      impact: t.impact,
      source: t.source,
      rationale: t.rationale,
      editedBy: t.edited_by,
      changeReason: t.change_reason,
      removed: t.removed,
      removalReason: t.removal_reason,
      change: null,
    }
    const edit = pending.edits[t.number]
    if (edit) {
      return {
        ...row,
        title: edit.title,
        owasp: owaspRefs(edit.owasp),
        atlas: atlasRef(edit.atlas),
        likelihood: edit.likelihood,
        impact: edit.impact,
        changeReason: edit.reason || null,
        change: "edited",
      }
    }
    if (pending.removals[t.number] !== undefined) {
      return { ...row, removed: true, removalReason: pending.removals[t.number], change: "removed" }
    }
    if (pending.restores.includes(t.number)) return { ...row, removed: false, removalReason: null, change: "restored" }
    return row
  })
  stored.sort(
    (a, b) =>
      Number(a.removed) - Number(b.removed) ||
      b.likelihood * b.impact - a.likelihood * a.impact ||
      (a.number ?? 0) - (b.number ?? 0),
  )
  const added = pending.additions.map(
    (a): ShownThreat => ({
      key: a.key,
      number: null,
      title: a.title,
      component_kind: a.component_kind,
      component_name: a.component_name,
      owasp: owaspRefs(a.owasp),
      atlas: atlasRef(a.atlas),
      likelihood: a.likelihood,
      impact: a.impact,
      source: "analyst",
      rationale: null,
      editedBy: null,
      changeReason: a.reason || null,
      removed: false,
      removalReason: null,
      change: "added",
    }),
  )
  return [...added, ...stored]
}

const KIND_ICON: Record<string, LucideIcon> = {
  model: Cpu,
  system_prompt: ScrollText,
  knowledge_source: Database,
  tool: Wrench,
  output: MessageSquareText,
}

function FilterItem({
  value,
  label,
  note,
  icon: Icon,
  pressed,
  threats,
  onFilter,
}: {
  value: string
  label: string
  note?: string
  icon: LucideIcon
  pressed: boolean
  threats: number
  onFilter: (filter: string) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`${label}, ${threats} ${threats === 1 ? "threat" : "threats"}${note ? `. ${note}` : ""}`}
      onClick={() => onFilter(value)}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm outline-none transition-colors",
        "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        pressed && "bg-primary/10 font-medium text-foreground hover:bg-primary/10",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors",
          pressed && "bg-primary text-primary-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words">{label}</span>
        {note && <span className="block text-xs font-normal text-muted-foreground">{note}</span>}
      </span>
      <span
        className={cn(
          "tabular shrink-0 rounded-full px-1.5 py-0.5 text-xs",
          pressed ? "bg-primary text-primary-foreground" : "bg-muted text-text-secondary",
        )}
      >
        {threats}
      </span>
    </button>
  )
}

/** The left panel of Screen 26: the target's components with their threat counts (FR-3.1). */
function ComponentsPanel({
  components,
  threats,
  filter,
  onFilter,
}: {
  components: ThreatComponent[]
  threats: ShownThreat[]
  filter: string
  onFilter: (filter: string) => void
}) {
  const active = threats.filter((t) => !t.removed)
  const countOf = (key: string) => active.filter((t) => componentKey(t.component_kind, t.component_name) === key).length
  const groups = KIND_ORDER.map((kind) => ({ kind, items: components.filter((c) => c.kind === kind) })).filter(
    (g) => g.items.length > 0,
  )
  const current = components.find((c) => componentKey(c.kind, c.name) === filter)
  const CurrentIcon = current ? (KIND_ICON[current.kind] ?? Layers) : Layers
  const [open, setOpen] = useState(false)
  const choose = (value: string) => {
    onFilter(value)
    setOpen(false)
  }

  return (
    <section aria-labelledby="components-heading" className="self-start rounded-[14px] border bg-card p-4">
      <h2 id="components-heading" className="text-[15px] font-semibold">
        Components
      </h2>
      <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
        {active.length} {active.length === 1 ? "threat" : "threats"} in {components.length}{" "}
        {components.length === 1 ? "component" : "components"}
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-12 w-full justify-between gap-2 px-2.5 font-normal"
            aria-label={`Component: ${current?.name ?? "All components"}. Choose another.`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                <CurrentIcon className="size-4" />
              </span>
              <span className="truncate font-medium">{current?.name ?? "All components"}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular rounded-full bg-muted px-2 py-0.5 text-xs text-text-secondary">
                {current ? countOf(filter) : active.length}
              </span>
              <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-64 p-2">
          <div className="max-h-96 overflow-y-auto">
            <FilterItem
              value="all"
              label="All components"
              icon={Layers}
              pressed={filter === "all"}
              threats={active.length}
              onFilter={choose}
            />
            <div className="mt-3 space-y-3">
              {groups.map((group) => (
                <div key={group.kind}>
                  <p className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {KIND_GROUP[group.kind]}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((c) => {
                      const key = componentKey(c.kind, c.name)
                      return (
                        <li key={key}>
                          <FilterItem
                            value={key}
                            label={c.name}
                            note={c.note}
                            icon={KIND_ICON[c.kind] ?? Layers}
                            pressed={filter === key}
                            threats={countOf(key)}
                            onFilter={choose}
                          />
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </section>
  )
}

/** What kind of draft this is and who made it (NFR-9.4: AI-generated until a person approves). */
function DraftBanner({ current }: { current: VersionDetail }) {
  const date = longDate(current.created_at)
  const origin =
    current.origin === "generated"
      ? `generated ${date}${
          current.trigger === "profile_review"
            ? " after a target profile update"
            : current.created_by
              ? ` at ${current.created_by}'s request`
              : ""
        }`
      : current.origin === "edited"
        ? `saved by ${current.created_by ?? "a person"} on ${date}`
        : `restored from version ${current.based_on_version} by ${current.created_by ?? "a person"} on ${date}`
  if (current.ai_generated) {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-[10px] border border-confirm/50 bg-confirm/10 px-4 py-3 text-sm">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-confirm" aria-hidden="true" />
        <p>
          <strong className="font-semibold">AI-generated draft</strong> — {origin}
          {current.origin !== "generated" && "; it still contains threats suggested by the LLM"}. A person must review and
          approve it.
        </p>
      </div>
    )
  }
  return (
    <Alert className="mb-4">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>
        <p>
          <strong className="font-semibold text-foreground">Draft</strong> — {origin}. A person must approve it before
          campaigns are based on it.
        </p>
      </AlertDescription>
    </Alert>
  )
}

/** Screen 26: one version of a target's threat model, its components and threats; reviewing and
 * approving it (UC-3.1 result, UC-3.2). Only a Security Analyst changes or approves it. */
export function ThreatModelReview({
  targetId,
  initialVersion,
  inTarget = false,
}: {
  targetId: string
  initialVersion: number | null
  /** Inside the target's tabs (Screen 20), not under Threat Models. */
  inTarget?: boolean
}) {
  const router = useRouter()
  const me = useSession().name
  const canManage = useCan("manage_threat_models")
  const [page, setPage] = useState<ThreatModelPage | null>(null)
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null)
  const [version, setVersion] = useState<number | null>(initialVersion)
  const [pending, setPending] = useState<Pending>(NONE)
  const [editing, setEditing] = useState<number | null>(null)
  const [removing, setRemoving] = useState<{ number: number; title: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState("all")
  const [pageIndex, setPageIndex] = useState(0)
  const [busy, setBusy] = useState<"save" | "approve" | null>(null)
  const [generating, setGenerating] = useState(false)
  const [newer, setNewer] = useState<VersionComparison | null>(null)
  const [saveErrors, setSaveErrors] = useState<string[]>([])
  const [announcement, setAnnouncement] = useState("")
  const addedCount = useRef(0)

  async function load(wanted: number | null): Promise<ThreatModelPage | null> {
    try {
      const found = await getThreatModel(targetId, wanted)
      setPage(found)
      setLoadError(null)
      return found
    } catch (caught) {
      setLoadError(problemOf(caught))
      return null
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    getThreatModel(targetId, version, controller.signal)
      .then((found) => {
        setPage(found)
        setLoadError(null)
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setLoadError(problemOf(caught))
      })
    return () => controller.abort()
  }, [targetId, version])

  usePageCrumbs(
    page
      ? inTarget
        ? [{ label: page.target.name, href: `/targets/${targetId}` }, { label: "Threat model" }]
        : [{ label: page.target.name }]
      : [],
  )

  const changes = count(pending)
  const current = page?.current ?? null
  const shownVersion = current?.version ?? null
  const active = jobActive(page?.job)

  // A generation runs on a worker; the page follows it. With unsaved changes it stays on the
  // version they were made to, so a new version never slips in under them (UC-3.2, 5b).
  useEffect(() => {
    if (!active) return
    const wanted = changes ? shownVersion : version
    const timer = window.setInterval(() => {
      getThreatModel(targetId, wanted)
        .then((found) => {
          setPage(found)
          if (!jobActive(found.job)) {
            setAnnouncement(
              found.job?.status === "failed" ? "The generation failed." : `Version ${found.versions[0]?.version} is ready.`,
            )
          }
        })
        .catch(() => undefined)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [active, changes, shownVersion, version, targetId])

  useEffect(() => {
    if (!changes) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [changes])

  const threats = useMemo(() => (current ? shownThreats(current.threats, pending) : []), [current, pending])
  const components = useMemo(() => {
    if (!current) return []
    const listed = new Set(current.components.map((c) => componentKey(c.kind, c.name)))
    const extra = pending.additions
      .filter((a) => !listed.has(componentKey(a.component_kind, a.component_name)))
      .map((a): ThreatComponent => ({ kind: a.component_kind, name: a.component_name, note: "", threats: 0 }))
    return [...current.components, ...extra.filter((c, i) => extra.findIndex((d) => d.name === c.name) === i)]
  }, [current, pending.additions])

  function selectVersion(value: number) {
    const newest = page?.versions[0]?.version
    setVersion(value === newest ? null : value)
    setFilter("all")
    setPageIndex(0)
    setEditing(null)
    router.replace(value === newest ? `/threat-models/${targetId}` : `/threat-models/${targetId}?version=${value}`, {
      scroll: false,
    })
  }

  function editThreat(number: number, form: ThreatForm) {
    const threat = current?.threats.find((t) => t.number === number)
    if (!threat) return
    const edit: ThreatEdit = {
      number,
      title: form.title.trim(),
      owasp: form.owasp,
      atlas: atlasOf(form),
      likelihood: form.likelihood,
      impact: form.impact,
      reason: form.reason.trim(),
    }
    const same =
      edit.title === threat.title &&
      edit.owasp.join() === threat.owasp.map((o) => o.code).join() &&
      edit.atlas === (threat.atlas?.code ?? null) &&
      edit.likelihood === threat.likelihood &&
      edit.impact === threat.impact
    setPending((p) => {
      const edits = { ...p.edits }
      if (same) delete edits[number]
      else edits[number] = edit
      return { ...p, edits }
    })
    setEditing(null)
    setAnnouncement(same ? "Nothing changed." : `Your change to “${edit.title}” is kept until you save.`)
  }

  function removeThreat(number: number, reason: string) {
    setPending((p) => {
      const edits = { ...p.edits }
      delete edits[number]
      return { ...p, edits, removals: { ...p.removals, [number]: reason } }
    })
    setAnnouncement("The threat is marked as removed until you save.")
  }

  function undo(threat: ShownThreat) {
    setPending((p) => {
      if (threat.change === "added") return { ...p, additions: p.additions.filter((a) => a.key !== threat.key) }
      const number = threat.number as number
      const edits = { ...p.edits }
      const removals = { ...p.removals }
      delete edits[number]
      delete removals[number]
      return { ...p, edits, removals, restores: p.restores.filter((n) => n !== number) }
    })
    setAnnouncement(`Your change to “${threat.title}” is undone.`)
  }

  function addThreat(threat: ThreatNew) {
    addedCount.current += 1
    setPending((p) => ({ ...p, additions: [...p.additions, { ...threat, key: `new-${addedCount.current}` }] }))
    setFilter("all")
    setPageIndex(0)
    setAnnouncement(`“${threat.title}” is added to your changes.`)
  }

  async function handleError(caught: unknown, from: number) {
    if (caught instanceof ApiError && caught.code === "newer_version") {
      const newest = Number(caught.details?.[0]?.message)
      try {
        setNewer(await compareVersions(targetId, from, newest))
      } catch {
        toast.error(caught.message)
      }
      return
    }
    if (caught instanceof ApiError && caught.details?.length) {
      setSaveErrors(caught.details.map((d) => d.message))
      return
    }
    toast.error(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.")
  }

  function showNewest(found: ThreatModelPage) {
    setPage(found)
    setVersion(null)
    setFilter("all")
    setPageIndex(0)
    router.replace(`/threat-models/${targetId}`, { scroll: false })
  }

  async function save(): Promise<ThreatModelPage | null> {
    if (!current) return null
    setBusy("save")
    setSaveErrors([])
    try {
      const result = await saveThreatModelVersion(targetId, {
        base_version: current.version,
        edit: Object.values(pending.edits),
        add: pending.additions.map((addition) => {
          const { key, ...threat } = addition
          void key
          return threat
        }),
        remove: Object.entries(pending.removals).map(([number, reason]) => ({ number: Number(number), reason })),
        restore: pending.restores,
      })
      setPending(NONE)
      setEditing(null)
      showNewest(result)
      const saved = result.current?.version
      toast.success(`Saved as version ${saved}. Version ${current.version} stays unchanged.`)
      setAnnouncement(`Saved as version ${saved}.`)
      return result
    } catch (caught) {
      await handleError(caught, current.version)
      return null
    } finally {
      setBusy(null)
    }
  }

  async function approve() {
    if (!current) return
    let number = current.version
    if (changes) {
      const saved = await save()
      if (!saved?.current) return
      number = saved.current.version
    }
    setBusy("approve")
    try {
      showNewest(await approveThreatModel(targetId, number))
      toast.success(`Version ${number} is approved.`)
      setAnnouncement(`Version ${number} is approved.`)
    } catch (caught) {
      await handleError(caught, number)
    } finally {
      setBusy(null)
    }
  }

  async function keepChanges() {
    const to = newer?.compare.version
    setNewer(null)
    const found = await load(null)
    if (!found?.current) return
    const byNumber = new Map(found.current.threats.map((t) => [t.number, t]))
    const applies = (number: string | number) => {
      const threat = byNumber.get(Number(number))
      return Boolean(threat && !threat.removed)
    }
    setPending((p) => ({
      edits: Object.fromEntries(Object.entries(p.edits).filter(([n]) => applies(n))),
      removals: Object.fromEntries(Object.entries(p.removals).filter(([n]) => applies(n))),
      restores: p.restores.filter((n) => byNumber.get(n)?.removed),
      additions: p.additions,
    }))
    showNewest(found)
    setAnnouncement(`Version ${to} is open. Your changes are kept where they still apply.`)
  }

  async function discardChanges() {
    setNewer(null)
    setPending(NONE)
    setEditing(null)
    const found = await load(null)
    if (found) showNewest(found)
  }

  async function generate() {
    setGenerating(true)
    try {
      const job = await generateThreatModel(targetId)
      if (job.status === "failed") toast.error(job.message ?? "The threat model couldn't be generated.")
      else setAnnouncement("Generating a new version. This page updates when it's ready.")
      await load(changes ? shownVersion : version)
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "The threat model couldn't be generated.")
    } finally {
      setGenerating(false)
    }
  }

  if (loadError?.code === "not_found" && !page) {
    return (
      <EmptyState
        title="Threat model not found"
        description={loadError.message}
        action={
          <Button asChild variant="outline">
            <Link href="/threat-models">Back to Threat Models</Link>
          </Button>
        }
      />
    )
  }
  if (loadError && !page) {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden="true" />
        <AlertDescription className="flex flex-wrap items-center gap-3">
          {loadError.message}
          <Button size="sm" variant="outline" className="h-8" onClick={() => void load(version)}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (!page) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading the threat model">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const { target } = page
  const newest = page.versions[0] ?? null
  const isNewest = Boolean(current && newest && current.version === newest.version)
  const archived = target.status === "archived"
  const editable = Boolean(canManage && current && isNewest && !archived)
  const canGenerate = Boolean(canManage && !page.blocker && !active)
  const visible = filter === "all" ? threats : threats.filter((t) => componentKey(t.component_kind, t.component_name) === filter)
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const index = Math.min(pageIndex, pages - 1)
  const pageThreats = visible.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE)
  const counts: ReviewCounts = {
    threats: threats.filter((t) => !t.removed).length,
    edited: Object.keys(pending.edits).length,
    removed: Object.keys(pending.removals).length,
    added: pending.additions.length,
    restored: pending.restores.length,
  }

  const generateButton = canGenerate && (
    <Button size="sm" variant="outline" className="h-8" onClick={() => void generate()} disabled={generating}>
      <Sparkles aria-hidden="true" />
      {generating ? "Starting…" : "Generate again"}
    </Button>
  )

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{target.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Threat model for {TYPE_PHRASE[target.type]} at{" "}
            <span className="font-mono break-all text-text-secondary">{target.host}</span>
          </p>
        </div>
        {current && (
          <div className="flex flex-wrap items-center gap-2">
            {/* The two pages that start from a version (UC-3.3 and UC-3.4). */}
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href={`/threat-models/${targetId}/recommendations`}>Recommended suites</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href={`/threat-models/${targetId}/versions`}>Version history</Link>
            </Button>
            <Label htmlFor="version-select" className="ml-1">
              Version
            </Label>
            <Select value={String(current.version)} onValueChange={(value) => selectVersion(Number(value))} disabled={changes > 0}>
              <SelectTrigger
                id="version-select"
                className="h-9 w-40"
                aria-describedby={changes > 0 ? "version-hint" : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {page.versions.map((v) => (
                  <SelectItem key={v.version} value={String(v.version)}>
                    v{v.version} · {v.status === "approved" ? "Approved" : "Draft"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {changes > 0 && (
              <p id="version-hint" className="sr-only">
                Save or undo your changes to switch versions.
              </p>
            )}
          </div>
        )}
      </div>
      {inTarget && <TargetTabs targetId={targetId} active="threat-model" />}

      <ModelJourney
        onGenerate={canGenerate && !generating ? () => void generate() : undefined}
        input={{
          targetId,
          blockerCode: page.blocker_code,
          blocker: page.blocker,
          job: page.job ? { status: page.job.status, message: page.job.message } : null,
          versions: page.versions,
          baselineOnly: Boolean(current?.baseline_only),
          canManage: Boolean(canManage),
        }}
      />

      {archived && (
        <Alert className="mb-4">
          <Archive aria-hidden="true" />
          <AlertDescription>This target is archived, so its threat model can only be read.</AlertDescription>
        </Alert>
      )}
      {active && (
        <Alert className="mb-4">
          <RefreshCw className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <AlertDescription>
            {current ? "Generating a new version of this threat model." : "Generating the first version."} This page
            updates when it&apos;s ready{changes > 0 ? "; your unsaved changes stay as they are" : ""}.
          </AlertDescription>
        </Alert>
      )}
      {page.job?.status === "failed" && (
        <Alert variant="destructive" className="mb-4">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>The last generation failed. {page.job.message}</span>
            {generateButton}
          </AlertDescription>
        </Alert>
      )}

      {!current ? (
        !active && (
          <EmptyState
            title="No threat model yet"
            description={
              page.blocker ??
              canManage ? "Generated from the reviewed profile." : "A Security Analyst can generate it."
            }
            action={
              canGenerate && (
                <Button className="hover:bg-primary-hover" onClick={() => void generate()} disabled={generating}>
                  <Sparkles aria-hidden="true" />
                  {generating ? "Starting…" : "Generate threat model"}
                </Button>
              )
            }
          />
        )
      ) : (
        <>
          {!isNewest && newest && (
            <Alert className="mb-4">
              <CircleAlert aria-hidden="true" />
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>
                  You&apos;re viewing version {current.version}, which is read-only. The newest is version{" "}
                  {newest.version}.
                </span>
                <Button size="sm" variant="outline" className="h-8" onClick={() => selectVersion(newest.version)}>
                  Open version {newest.version}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {isNewest && current.status === "draft" && <DraftBanner current={current} />}
          {isNewest && current.baseline_only && (
            <Alert className="mb-4">
              <AlertTriangle className="text-warning" aria-hidden="true" />
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>{current.baseline_only}</span>
                {generateButton}
              </AlertDescription>
            </Alert>
          )}

          <div className="mb-5">
            <ThreatMap
              targetName={target.name}
              components={components}
              threats={threats}
              onPick={(picked) => {
                setFilter(picked ?? "all")
                setPageIndex(0)
              }}
            />
          </div>

          {/* Components, threats and the review panel stand beside each other only from 1280 px
              on; below that they stand under each other, so the threats keep their width. */}
          <div className="grid gap-5 xl:grid-cols-[232px_minmax(0,1fr)_264px]">
            <ComponentsPanel
              components={components}
              threats={threats}
              filter={filter}
              onFilter={(value) => {
                setFilter(value)
                setPageIndex(0)
              }}
            />

            <section aria-labelledby="threats-heading" className="@container min-w-0 self-start overflow-hidden rounded-2xl border bg-card">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-3">
                <div>
                  <h2 id="threats-heading" className="flex items-center gap-2 text-[15px] font-semibold">
                    Threats
                    <span className="tabular rounded-full bg-muted px-2 text-xs font-medium text-text-secondary">
                      {counts.threats}
                    </span>
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Risk is likelihood × impact, each rated 1–5. A new threat needs at least one OWASP category.
                  </p>
                </div>
                {editable && (
                  <Button variant="outline" size="sm" className="h-9" onClick={() => setAdding(true)}>
                    <Plus aria-hidden="true" />
                    Add threat
                  </Button>
                )}
              </div>
              {pageThreats.length === 0 ? (
                <p className="border-t px-4 py-8 text-center text-sm text-muted-foreground">
                  No threats for this component.
                </p>
              ) : (
                <ul aria-label="Threats, removed ones last">
                  {pageThreats.map((threat) => (
                    <ThreatItem
                      key={threat.key}
                      threat={threat}
                      editable={editable}
                      editing={editing !== null && editing === threat.number}
                      me={me}
                      onEdit={() => setEditing(threat.number)}
                      onCancel={() => setEditing(null)}
                      onSave={(form) => threat.number !== null && editThreat(threat.number, form)}
                      onRemove={() => threat.number !== null && setRemoving({ number: threat.number, title: threat.title })}
                      onUndo={() => undo(threat)}
                      onRestore={() =>
                        threat.number !== null &&
                        setPending((p) => ({ ...p, restores: [...p.restores, threat.number as number] }))
                      }
                    />
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
                <span>{plural(visible.length, "threat", "threats")} · sorted by risk</span>
                <div className="flex items-center gap-2">
                  <span>
                    Page {index + 1} of {pages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={() => setPageIndex(index - 1)}
                    disabled={index === 0}
                    aria-label="Previous page"
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={() => setPageIndex(index + 1)}
                    disabled={index >= pages - 1}
                    aria-label="Next page"
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </section>

            <div className="space-y-4 self-start">
              <ReviewPanel
                counts={counts}
                version={current.version}
                nextVersion={(newest?.version ?? current.version) + 1}
                status={current.status}
                approvedBy={current.approved_by}
                approvedAt={current.approved_at}
                editable={editable}
                busy={busy}
                onSave={() => void save()}
                onApprove={() => void approve()}
              />
              {saveErrors.length > 0 && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>
                    <p className="font-medium">Your changes couldn&apos;t be saved:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {saveErrors.map((message, i) => (
                        <li key={i}>{message}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {!canManage && canManage !== undefined && (
                <p className="px-1 text-sm text-muted-foreground">
                  Only a Security Analyst can review and approve threat models.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      <AddThreatDialog open={adding} components={components} onClose={() => setAdding(false)} onAdd={addThreat} />
      <RemoveThreatDialog threat={removing} onClose={() => setRemoving(null)} onRemove={removeThreat} />
      <NewerVersionDialog comparison={newer} onKeep={() => void keepChanges()} onDiscard={() => void discardChanges()} />
    </div>
  )
}
