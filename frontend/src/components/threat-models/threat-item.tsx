"use client"

import { useState } from "react"
import { Pencil, RotateCcw, Trash2, Undo2 } from "lucide-react"

import { AtlasId } from "@/components/sentra/framework-ids"
import { CHIP, SourceChip } from "@/components/threat-models/badges"
import { ThreatFields, type ThreatForm, formOf, formProblems } from "@/components/threat-models/threat-fields"
import { Button } from "@/components/ui/button"
import type { FrameworkRef, ThreatSource } from "@/lib/threat-models"
import { cn } from "@/lib/utils"

/** A threat as shown: stored, or with the analyst's changes that aren't saved yet. */
export type ShownThreat = {
  key: string
  number: number | null // null for a threat added in this review
  title: string
  component_kind: string
  component_name: string
  owasp: FrameworkRef[]
  atlas: FrameworkRef | null
  likelihood: number
  impact: number
  source: ThreatSource
  rationale: string | null
  /** Who changed it in the version shown (saved changes) */
  editedBy: string | null
  changeReason: string | null
  removed: boolean
  removalReason: string | null
  /** The analyst's unsaved change to it */
  change: "edited" | "removed" | "restored" | "added" | null
}

/** Column widths shared with the header above the list (Screen 26). The threats card is a
 * container (`@container`), so the columns appear when the card itself is wide enough for them
 * (@xl = 576 px), not when the window is: from 1280 px on, the components and the review panel
 * stand beside the card and make it narrow again until about 1416 px. While the card is narrower,
 * each threat shows its fields as label and value, one under the other (NFR-4.4). */
export const COLUMNS = "@xl:grid-cols-[minmax(4.5rem,auto)_7rem_3.75rem_3.25rem_2.5rem_minmax(0,1fr)]"

function Value({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-2 @xl:block", className)}>
      <dt className="w-24 shrink-0 text-xs text-muted-foreground @xl:sr-only">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function ThreatEditForm({
  threat,
  id,
  onCancel,
  onSave,
}: {
  threat: ShownThreat
  id: string
  onCancel: () => void
  onSave: (form: ThreatForm) => void
}) {
  const [form, setForm] = useState<ThreatForm>(() => formOf(threat))
  const [errors, setErrors] = useState<Record<string, string>>({})

  function save(event: React.FormEvent) {
    event.preventDefault()
    const problems = formProblems(form)
    setErrors(problems)
    if (Object.keys(problems).length === 0) onSave(form)
  }

  return (
    <form onSubmit={save} noValidate className="mt-3 space-y-3">
      <ThreatFields
        id={id}
        form={form}
        onChange={(change) => setForm((current) => ({ ...current, ...change }))}
        errors={errors}
        reasonLabel="Reason for the change (optional)"
        reasonHint="Shown with the change when versions are compared, e.g. what a campaign run showed."
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="outline" aria-label={`Save changes to ${threat.title}`}>
          Save
        </Button>
      </div>
    </form>
  )
}

export function ThreatItem({
  threat,
  editable,
  editing,
  me,
  onEdit,
  onCancel,
  onSave,
  onRemove,
  onUndo,
  onRestore,
}: {
  threat: ShownThreat
  editable: boolean
  editing: boolean
  me: string
  onEdit: () => void
  onCancel: () => void
  onSave: (form: ThreatForm) => void
  onRemove: () => void
  onUndo: () => void
  onRestore: () => void
}) {
  const id = `threat-${threat.key}`
  const struck = threat.removed

  const chips = (
    <>
      {threat.removed && (
        <span className={cn(CHIP, "border-destructive/50 text-destructive")}>
          <Trash2 className="size-3.5" aria-hidden="true" />
          Removed
        </span>
      )}
      {editing && (
        <span className={cn(CHIP, "border-primary/50 text-link")}>
          <Pencil className="size-3.5" aria-hidden="true" />
          Editing
        </span>
      )}
      {!editing && threat.change === "edited" && <span className={cn(CHIP, "border-primary/40 text-link")}>Edited by you</span>}
      {threat.change === "added" && <span className={cn(CHIP, "border-primary/40 text-link")}>Added by you</span>}
      {threat.change === "restored" && <span className={cn(CHIP, "border-primary/40 text-link")}>Restored by you</span>}
      {threat.change === null && threat.editedBy && (
        <span className={cn(CHIP, "border-border-strong text-text-secondary")}>
          Edited by {threat.editedBy === me ? "you" : threat.editedBy}
        </span>
      )}
    </>
  )

  return (
    <li
      className={cn(
        "border-t px-4 py-3",
        threat.change && "bg-accent/40",
        editing && "bg-accent/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 id={`${id}-title`} className={cn("text-sm font-medium", struck && "text-muted-foreground line-through")}>
            {threat.title}
          </h3>
          {chips}
        </div>
        {editable && !editing && (
          <div className="-mt-1 -mr-2 flex shrink-0 gap-1">
            {threat.change ? (
              <Button variant="ghost" size="icon" className="size-8" onClick={onUndo} aria-label={`Undo your change to ${threat.title}`}>
                <Undo2 aria-hidden="true" />
              </Button>
            ) : threat.removed ? (
              <Button variant="ghost" size="sm" className="h-8" onClick={onRestore} aria-label={`Restore ${threat.title}`}>
                <RotateCcw aria-hidden="true" />
                Restore
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="icon" className="size-8" onClick={onEdit} aria-label={`Edit ${threat.title}`}>
                  <Pencil aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8" onClick={onRemove} aria-label={`Remove ${threat.title}`}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <ThreatEditForm threat={threat} id={id} onCancel={onCancel} onSave={onSave} />
      ) : (
        <dl className={cn("mt-2 grid gap-x-3 gap-y-1 @xl:items-center", COLUMNS)}>
          <Value label="OWASP">
            <span className="font-mono text-xs">
              {threat.owasp.map((o, index) => (
                <span key={o.code}>
                  {index > 0 && ", "}
                  <abbr title={o.name ?? undefined} className="no-underline">
                    {o.code}
                  </abbr>
                </span>
              ))}
            </span>
          </Value>
          <Value label="MITRE ATLAS">
            {threat.atlas ? (
              <abbr title={threat.atlas.name ?? undefined} className="text-xs no-underline">
                <AtlasId code={threat.atlas.code} />
              </abbr>
            ) : (
              <>
                <span aria-hidden="true">—</span>
                <span className="sr-only">None applies</span>
              </>
            )}
          </Value>
          <Value label="Likelihood">
            <span className="tabular">{threat.likelihood}</span>
          </Value>
          <Value label="Impact">
            <span className="tabular">{threat.impact}</span>
          </Value>
          <Value label="Risk">
            <span className="tabular font-semibold">{threat.likelihood * threat.impact}</span>
          </Value>
          <Value label="Source">
            <SourceChip source={threat.source} />
          </Value>
        </dl>
      )}

      {!editing && threat.removed && threat.removalReason && (
        <p className="mt-2 text-sm text-text-secondary">
          <span className="text-muted-foreground">Reason </span>
          {threat.removalReason}
        </p>
      )}
      {!editing && !threat.removed && threat.changeReason && (threat.change === "edited" || threat.editedBy) && (
        <p className="mt-2 text-sm text-text-secondary">
          <span className="text-muted-foreground">Reason for the change </span>
          {threat.changeReason}
        </p>
      )}
      {!editing && threat.source === "ai_suggested" && threat.rationale && (
        <p className="mt-1 text-xs text-muted-foreground">Why the LLM suggests it: {threat.rationale}</p>
      )}
    </li>
  )
}
