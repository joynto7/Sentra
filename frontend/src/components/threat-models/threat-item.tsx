"use client"

import { useState } from "react"
import { Pencil, RotateCcw, Trash2, Undo2 } from "lucide-react"

import { AtlasId } from "@/components/sentra/framework-ids"
import { CHIP, SourceChip } from "@/components/threat-models/badges"
import { ThreatFields, type ThreatForm, formOf, formProblems } from "@/components/threat-models/threat-fields"
import { Button } from "@/components/ui/button"
import { type FrameworkRef, type ThreatSource } from "@/lib/threat-models"
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

/** The risk of a threat (likelihood times impact), toned by how high it is; the number is always written. */
function riskTone(risk: number): string {
  if (risk >= 15) return "bg-[var(--severity-critical-bg)] text-[var(--severity-critical-text)]"
  if (risk >= 9) return "bg-[var(--severity-medium-bg)] text-[var(--severity-medium-text)]"
  return "bg-muted text-text-secondary"
}

/** A rating from 1 to 5 as five dots, filled up to the rating; the words are for screen readers. */
function Rating({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={cn("size-2 rounded-full border border-foreground/50", n <= value && "bg-foreground/70")} />
        ))}
      </span>
      <span className="tabular text-foreground">{value}</span>
      <span className="sr-only"> of 5</span>
    </span>
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

  const risk = threat.likelihood * threat.impact

  return (
    <li
      className={cn(
        "group border-t px-4 py-3.5 transition-colors hover:bg-muted/30 motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in motion-safe:slide-in-from-bottom-1",
        threat.change && "border-l-2 border-l-primary bg-accent/40",
        editing && "bg-accent/60",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-12 shrink-0 flex-col items-center justify-center rounded-xl leading-none",
            struck ? "bg-muted text-muted-foreground" : riskTone(risk),
          )}
          title={`Risk ${risk}: likelihood ${threat.likelihood} times impact ${threat.impact}`}
        >
          <span className="tabular text-lg font-semibold">{risk}</span>
          <span className="mt-0.5 text-[10px] font-medium tracking-wide uppercase">Risk</span>
          <span className="sr-only">
            : likelihood {threat.likelihood} times impact {threat.impact}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={`${id}-title`} className={cn("text-sm font-medium", struck && "text-muted-foreground line-through")}>
              {threat.title}
            </h3>
            {chips}
          </div>

          {!editing && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <SourceChip source={threat.source} />
              {threat.owasp.map((o) => (
                <abbr key={o.code} title={o.name ?? undefined} className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs no-underline">
                  {o.code}
                </abbr>
              ))}
              {threat.atlas && (
                <abbr title={threat.atlas.name ?? undefined} className="text-xs no-underline">
                  <AtlasId code={threat.atlas.code} />
                </abbr>
              )}
              <Rating label="Likelihood" value={threat.likelihood} />
              <Rating label="Impact" value={threat.impact} />
            </div>
          )}
        </div>

        {editable && !editing && (
          <div className="-mt-1 -mr-2 flex shrink-0 gap-1 opacity-80 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
                <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={onEdit} aria-label={`Edit ${threat.title}`}>
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full"
                  onClick={onRemove}
                  aria-label={`Remove ${threat.title}`}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {editing && <ThreatEditForm threat={threat} id={id} onCancel={onCancel} onSave={onSave} />}

      {!editing && threat.removed && threat.removalReason && (
        <p className="mt-2 pl-15 text-sm text-text-secondary">
          <span className="text-muted-foreground">Reason </span>
          {threat.removalReason}
        </p>
      )}
      {!editing && !threat.removed && threat.changeReason && (threat.change === "edited" || threat.editedBy) && (
        <p className="mt-2 pl-15 text-sm text-text-secondary">
          <span className="text-muted-foreground">Reason for the change </span>
          {threat.changeReason}
        </p>
      )}
      {!editing && threat.source === "ai_suggested" && threat.rationale && (
        <p className="mt-1 pl-15 text-xs text-muted-foreground">{threat.rationale}</p>
      )}
      {!editing && threat.source === "analyst" && (
        <p className="mt-1 pl-15 text-xs text-muted-foreground">
          Added by an analyst{threat.changeReason ? `: ${threat.changeReason}` : ""}.
        </p>
      )}
    </li>
  )
}
