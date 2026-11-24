"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Info, Loader2, Plus, TriangleAlert, X } from "lucide-react"
import { toast } from "sonner"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { TargetTabs } from "@/components/targets/target-tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import {
  type ProfileKnowledge,
  type ProfileSource,
  type ProfileTool,
  SOURCE_LABEL,
  type Target,
  type TargetProfile,
  formatDateTime,
  getProfile,
  getTarget,
  saveProfile,
  startProfileMapping,
} from "@/lib/targets"
import { cn } from "@/lib/utils"

const NOT_MAPPED =
  "Sentra maps the profile after the ownership check, from a few harmless discovery requests."
const POLL_MS = 3000
const MAX_POLLS = 60 // three minutes: the mapping sends a few requests within the target's rate

/** The entries of each card, in the order of Screen 21. */
const GROUPS: { id: string; title: string; keys: string[] }[] = [
  { id: "behaviour", title: "Model behaviour", keys: ["model_behaviour", "refusals", "underlying_model"] },
  { id: "io", title: "Input and output", keys: ["input_output"] },
  { id: "auth", title: "Authentication", keys: ["authentication"] },
  { id: "knowledge", title: "Knowledge sources", keys: ["knowledge_summary"] },
  { id: "tools", title: "Tools and parameters", keys: ["tools_summary"] },
  { id: "limits", title: "Rate limits", keys: ["rate_limits"] },
]

const CHIP = "inline-flex h-5 items-center rounded border px-1.5 text-[11px] font-medium whitespace-nowrap"
const SOURCE_STYLE: Record<ProfileSource, string> = {
  discovered: "border-primary/50 text-primary",
  manual: "border-border-strong text-muted-foreground",
  unknown: "border-warning/60 text-warning",
}

/** Where an entry comes from, as a chip (UC-2.4 step 6): discovered, added manually or unknown. */
function SourceChip({ source }: { source: ProfileSource }) {
  return <span className={cn(CHIP, SOURCE_STYLE[source])}>{SOURCE_LABEL[source]}</span>
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="What the chips mean">
      {(["discovered", "manual", "unknown"] as ProfileSource[]).map((source) => (
        <li key={source}>
          <SourceChip source={source} />
        </li>
      ))}
    </ul>
  )
}

type Draft = {
  entries: Record<string, string>
  tools: ProfileTool[]
  knowledge: ProfileKnowledge[]
}

function draftOf(profile: TargetProfile): Draft {
  return {
    entries: Object.fromEntries(profile.entries.map((entry) => [entry.key, entry.value])),
    tools: profile.tools.map((tool) => ({ ...tool })),
    knowledge: profile.knowledge_sources.map((source) => ({ ...source })),
  }
}

function Card({
  title,
  editing,
  canEdit,
  wide,
  onEdit,
  children,
}: {
  title: string
  editing: boolean
  canEdit: boolean
  /** A card that needs the whole width, such as the table of tools. */
  wide?: boolean
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <section className={cn("min-w-0 space-y-3 rounded-[10px] border bg-card p-5", wide && "lg:col-span-2")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" className="h-8" onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>
      {children}
    </section>
  )
}

/**
 * Screen 21: reviewing the Target Profile (UC-2.4 steps 5 and 6, alternatives 2a and 3a). What a
 * person changes or adds is marked "added manually" when it is saved, and the saved profile is
 * the basis of the threat model (FR-2.5, FR-3.1).
 */
export function ProfileReview({ id }: { id: string }) {
  const canMap = useCan("map_target_profiles")
  const [starting, setStarting] = useState(false)
  const [target, setTarget] = useState<Target | null>(null)
  const [profile, setProfile] = useState<TargetProfile | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editing, setEditing] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  // The version just saved: what it sets going is said until the page is left
  const [savedVersion, setSavedVersion] = useState<number | null>(null)
  const [polls, setPolls] = useState(0)

  usePageCrumbs([{ label: target?.name ?? "Target", href: `/targets/${id}` }, { label: "Profile" }])

  useEffect(() => {
    getTarget(id)
      .then(setTarget)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
  }, [id])

  const load = useCallback(
    (signal?: AbortSignal) =>
      getProfile(id, signal)
        .then((found) => {
          setProfile(found)
          setDraft(draftOf(found))
          setProblem(null)
        })
        .catch((error) => {
          if (error instanceof ApiError && error.status === 404) setProblem(error.message)
        }),
    [id],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // While the mapping runs, ask again until it is ready (UC-2.4 steps 1 to 4).
  useEffect(() => {
    if (profile?.status !== "mapping" || polls > MAX_POLLS) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setPolls((n) => n + 1)
      void load(controller.signal)
    }, POLL_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [profile, polls, load])

  const dirty = useMemo(() => {
    if (!profile || !draft) return false
    return JSON.stringify(draft) !== JSON.stringify(draftOf(profile))
  }, [profile, draft])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  const save = useCallback(async () => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await saveProfile(id, {
        entries: Object.fromEntries(Object.entries(draft.entries).map(([key, value]) => [key, { value }])),
        tools: draft.tools
          .filter((tool) => tool.name.trim())
          .map(({ name, parameters, side_effect }) => ({ name, parameters, side_effect })),
        knowledge_sources: draft.knowledge
          .filter((source) => source.name.trim())
          .map(({ name, description, access }) => ({ name, description, access })),
      })
      setProfile(saved)
      setDraft(draftOf(saved))
      setEditing([])
      setSavedVersion(saved.version)
      toast.success("Target Profile saved", {
        description: "Your corrections are marked as added manually and kept in the target's history.",
      })
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The profile could not be saved.")
    } finally {
      setSaving(false)
    }
  }, [draft, id])

  async function mapNow() {
    setStarting(true)
    try {
      setProfile(await startProfileMapping(id))
      setPolls(0)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The mapping could not be started.")
    } finally {
      setStarting(false)
    }
  }

  if (notFound) {
    return (
      <EmptyState
        title="Target not found"
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/targets">Back to targets</Link>
          </Button>
        }
      />
    )
  }
  const missing = problem ?? (profile?.status === "not_mapped" ? NOT_MAPPED : null)
  if (missing) {
    return (
      <>
        {target && <TargetTabs targetId={target.id} active="profile" />}
        <EmptyState
          title="No Target Profile yet"
          description={missing}
          action={
            target && target.status !== "verified" ? (
              <Button asChild variant="outline" className="h-9">
                <Link href={`/targets/${id}/verify`}>Verify ownership</Link>
              </Button>
            ) : target && canMap === true && profile?.status === "not_mapped" ? (
              <Button className="h-9" disabled={starting} onClick={() => void mapNow()}>
                {starting ? "Starting…" : "Map the profile now"}
              </Button>
            ) : (
              <Button asChild variant="outline" className="h-9">
                <Link href={`/targets/${id}`}>Back to the target</Link>
              </Button>
            )
          }
        />
      </>
    )
  }
  if (!target || !profile || !draft) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the Target Profile">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const canEdit = canMap === true && profile.status !== "mapping" && target.status !== "archived"
  const entry = (key: string) => profile.entries.find((row) => row.key === key)
  const isEditing = (group: string) => editing.includes(group)
  const edit = (group: string) => setEditing((list) => [...list, group])
  const setEntry = (key: string, value: string) =>
    setDraft((old) => (old ? { ...old, entries: { ...old.entries, [key]: value } } : old))

  return (
    <div className="pb-24">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{target.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Target Profile · version {profile.version}</p>
      </div>

      <TargetTabs targetId={target.id} active="profile" />

      {profile.status === "mapping" ? (
        <p className="flex items-start gap-2 rounded-[10px] border bg-card p-4 text-sm" aria-live="polite">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          Sentra is mapping the profile: a few harmless discovery requests within the target&apos;s rate. This page
          shows the result as soon as it is ready.
        </p>
      ) : profile.status === "partial" || profile.status === "failed" ? (
        <p role="alert" className="flex items-start gap-2 rounded-[10px] border border-warning/40 bg-warning/5 p-4 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {profile.stop_reason ?? "The mapping stopped early. Complete the entries marked Unknown."}
        </p>
      ) : (
        <p className="flex items-start gap-2 rounded-[10px] border bg-card p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {profile.status === "reviewed" ? "Profile reviewed" : "Profile ready for review"}
            {profile.mapped_at ? ` — mapped ${formatDateTime(profile.mapped_at)}` : ""}
            {profile.discovery_requests
              ? ` with ${profile.discovery_requests} harmless discovery ${
                  profile.discovery_requests === 1 ? "request" : "requests"
                }`
              : ""}
            {profile.reviewed_at && profile.reviewed_by
              ? ` · saved by ${profile.reviewed_by} on ${formatDateTime(profile.reviewed_at)}`
              : ""}
            . Your corrections become the basis of the Threat Model.
          </span>
        </p>
      )}

      {savedVersion !== null && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-[10px] border border-primary/30 bg-primary/5 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            Version {savedVersion} is saved. Sentra starts a new threat model from it when it can. That model is a draft until a Security Analyst reviews and approves it, and until then
            assessments keep using the approved model made from the earlier profile.{" "}
            <Link href={`/threat-models/${target.id}`} className="font-medium text-link hover:underline">
              Open the threat model
            </Link>
          </span>
        </p>
      )}

      <div className="mt-4">
        <Legend />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {GROUPS.map((group) => (
          <Card
            key={group.id}
            title={group.title}
            editing={isEditing(group.id)}
            canEdit={canEdit}
            wide={group.id === "tools"}
            onEdit={() => edit(group.id)}
          >
            <dl className={cn("space-y-3", !group.keys.some(entry) && "hidden")}>
              {group.keys.map((key) => {
                const row = entry(key)
                if (!row) return null
                return (
                  <div key={key} className="space-y-1">
                    <dt className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {row.label}
                      <SourceChip source={draft.entries[key] !== row.value ? "manual" : row.source} />
                    </dt>
                    <dd>
                      {isEditing(group.id) ? (
                        <Textarea
                          aria-label={row.label}
                          value={draft.entries[key] ?? ""}
                          maxLength={600}
                          rows={3}
                          onChange={(event) => setEntry(key, event.target.value)}
                          className="text-sm"
                        />
                      ) : (
                        <p className={cn("text-sm", !draft.entries[key] && "text-warning")}>
                          {draft.entries[key] || "Unknown — please complete."}
                        </p>
                      )}
                      {row.note && <p className="mt-1 text-xs text-muted-foreground">{row.note}</p>}
                    </dd>
                  </div>
                )
              })}
            </dl>

            {group.id === "knowledge" && (
                <div className="space-y-2">
                  {draft.knowledge.length === 0 && !isEditing("knowledge") && (
                    <p className="text-sm text-muted-foreground">No knowledge source recorded.</p>
                  )}
                  <ul className="space-y-2">
                    {draft.knowledge.map((source, index) => (
                      <li key={index} className="rounded-[7px] border p-3">
                        {isEditing("knowledge") ? (
                          <div className="space-y-2">
                            <Input
                              aria-label={`Knowledge source ${index + 1} name`}
                              value={source.name}
                              maxLength={120}
                              placeholder="Name"
                              className="h-9"
                              onChange={(event) =>
                                setDraft((old) =>
                                  old
                                    ? {
                                        ...old,
                                        knowledge: old.knowledge.map((row, i) =>
                                          i === index ? { ...row, name: event.target.value } : row,
                                        ),
                                      }
                                    : old,
                                )
                              }
                            />
                            <Input
                              aria-label={`Knowledge source ${index + 1} description`}
                              value={source.description}
                              maxLength={300}
                              placeholder="What it contains, for example 214 documents"
                              className="h-9"
                              onChange={(event) =>
                                setDraft((old) =>
                                  old
                                    ? {
                                        ...old,
                                        knowledge: old.knowledge.map((row, i) =>
                                          i === index ? { ...row, description: event.target.value } : row,
                                        ),
                                      }
                                    : old,
                                )
                              }
                            />
                            <div className="flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1.5"
                                onClick={() =>
                                  setDraft((old) =>
                                    old ? { ...old, knowledge: old.knowledge.filter((_, i) => i !== index) } : old,
                                  )
                                }
                              >
                                <X aria-hidden="true" />
                                Remove
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{source.name}</p>
                              {source.description && (
                                <p className="text-xs text-muted-foreground">{source.description}</p>
                              )}
                            </div>
                            <SourceChip source={source.source} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {isEditing("knowledge") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() =>
                        setDraft((old) =>
                          old
                            ? {
                                ...old,
                                knowledge: [
                                  ...old.knowledge,
                                  { name: "", description: "", access: "", source: "manual" },
                                ],
                              }
                            : old,
                        )
                      }
                    >
                      <Plus aria-hidden="true" />
                      Add knowledge source
                    </Button>
                  )}
                </div>
              )}

              {group.id === "tools" && (
                <div className="space-y-2">
                  {draft.tools.length === 0 && !isEditing("tools") ? (
                    <p className="text-sm text-muted-foreground">No tool recorded.</p>
                  ) : (
                    <Table
                      container={{
                        tabIndex: 0,
                        role: "group",
                        "aria-label": "Tools of this target",
                        className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      }}
                    >
                        <TableHeader className="bg-muted">
                          <TableRow>
                            <TableHead className="text-xs">Tool</TableHead>
                            <TableHead className="text-xs">Parameters</TableHead>
                            <TableHead className="text-xs">Side effect</TableHead>
                            <TableHead className="text-xs">Source</TableHead>
                            {isEditing("tools") && (
                              <TableHead className="w-10 text-xs">
                                <span className="sr-only">Remove</span>
                              </TableHead>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {draft.tools.map((tool, index) => (
                            <TableRow key={index}>
                              {(["name", "parameters", "side_effect"] as const).map((field) => (
                                <TableCell key={field} className="align-top">
                                  {isEditing("tools") ? (
                                    <Input
                                      aria-label={`Tool ${index + 1} ${field.replace("_", " ")}`}
                                      value={tool[field]}
                                      maxLength={field === "name" ? 80 : field === "parameters" ? 200 : 60}
                                      className="h-8 min-w-28"
                                      onChange={(event) =>
                                        setDraft((old) =>
                                          old
                                            ? {
                                                ...old,
                                                tools: old.tools.map((row, i) =>
                                                  i === index ? { ...row, [field]: event.target.value } : row,
                                                ),
                                              }
                                            : old,
                                        )
                                      }
                                    />
                                  ) : (
                                    <span className={cn("text-[13px]", field === "name" && "font-mono")}>
                                      {tool[field] || "–"}
                                    </span>
                                  )}
                                </TableCell>
                              ))}
                              <TableCell className="align-top">
                                <SourceChip source={tool.source} />
                              </TableCell>
                              {isEditing("tools") && (
                                <TableCell className="align-top">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    aria-label={`Remove tool ${tool.name || index + 1}`}
                                    onClick={() =>
                                      setDraft((old) =>
                                        old ? { ...old, tools: old.tools.filter((_, i) => i !== index) } : old,
                                      )
                                    }
                                  >
                                    <X aria-hidden="true" />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                    </Table>
                  )}
                  {isEditing("tools") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() =>
                        setDraft((old) =>
                          old
                            ? {
                                ...old,
                                tools: [...old.tools, { name: "", parameters: "", side_effect: "", source: "manual" }],
                              }
                            : old,
                        )
                      }
                    >
                      <Plus aria-hidden="true" />
                      Add tool
                    </Button>
                  )}
              </div>
            )}
          </Card>
        ))}
      </div>

      {canEdit && (dirty || profile.status === "ready" || profile.status === "partial") && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-card/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 py-3 pr-24 pl-6">
            <p className="text-sm text-muted-foreground">
              {dirty
                ? "Changed entries are saved as added manually, and the change is kept in the target's history."
                : "The mapped profile is ready for you to check. When it looks right, confirm it: it becomes the basis of the threat model."}
            </p>
            <div className="flex flex-wrap gap-2">
              {dirty && (
                <Button
                  variant="outline"
                  className="h-9"
                  disabled={saving}
                  onClick={() => {
                    setDraft(draftOf(profile))
                    setEditing([])
                  }}
                >
                  Discard changes
                </Button>
              )}
              <Button className="h-9 hover:bg-primary-hover" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : dirty ? "Save profile" : "Confirm the profile"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
