"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ATLAS_PATTERN,
  ATLAS_TECHNIQUES,
  OWASP_CATEGORIES,
  RATINGS,
  RATING_LABEL,
  type Threat,
} from "@/lib/threat-models"
import { cn } from "@/lib/utils"

/** The editable fields of a threat (UC-3.2 step 3). */
export type ThreatForm = {
  title: string
  owasp: string[]
  /** "none", a technique of the list, or "other" with `atlasOther` */
  atlas: string
  atlasOther: string
  likelihood: number
  impact: number
  reason: string
}

const KNOWN = new Set(ATLAS_TECHNIQUES.map((t) => t.code))

export function formOf(threat: Pick<Threat, "title" | "owasp" | "atlas" | "likelihood" | "impact">): ThreatForm {
  const atlas = threat.atlas?.code ?? null
  return {
    title: threat.title,
    owasp: threat.owasp.map((o) => o.code),
    atlas: atlas === null ? "none" : KNOWN.has(atlas) ? atlas : "other",
    atlasOther: atlas !== null && !KNOWN.has(atlas) ? atlas : "",
    likelihood: threat.likelihood,
    impact: threat.impact,
    reason: "",
  }
}

export const emptyForm = (): ThreatForm => ({
  title: "",
  owasp: [],
  atlas: "none",
  atlasOther: "",
  likelihood: 3,
  impact: 3,
  reason: "",
})

/** The technique the form names, or null. */
export function atlasOf(form: ThreatForm): string | null {
  if (form.atlas === "none") return null
  return form.atlas === "other" ? form.atlasOther.trim() : form.atlas
}

/** The problems of a form, keyed by field ("title", "owasp", "atlas"). */
export function formProblems(form: ThreatForm): Record<string, string> {
  const problems: Record<string, string> = {}
  const title = form.title.trim()
  if (title.length < 5) problems.title = "Describe the threat in at least 5 characters."
  else if (title.length > 200) problems.title = "Use at most 200 characters."
  // UC-3.2, 3a: a threat needs at least one OWASP category before it can be saved.
  if (form.owasp.length === 0) problems.owasp = "Choose at least one OWASP category."
  if (form.atlas === "other" && !ATLAS_PATTERN.test(form.atlasOther.trim())) {
    problems.atlas = "Use a MITRE ATLAS ID such as AML.T0051."
  }
  return problems
}

function described(...ids: (string | false | undefined)[]) {
  const list = ids.filter(Boolean).join(" ")
  return list || undefined
}

/** Title, OWASP categories, ATLAS technique, likelihood, impact and an optional reason. */
export function ThreatFields({
  id,
  form,
  onChange,
  errors,
  reasonLabel,
  reasonHint,
  autoFocus = false,
}: {
  id: string
  form: ThreatForm
  onChange: (change: Partial<ThreatForm>) => void
  errors: Record<string, string>
  reasonLabel: string
  reasonHint: string
  autoFocus?: boolean
}) {
  const risk = form.likelihood * form.impact
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-title`}>Threat</Label>
        <Input
          id={`${id}-title`}
          value={form.title}
          onChange={(event) => onChange({ title: event.target.value })}
          maxLength={220}
          autoFocus={autoFocus}
          placeholder="What could go wrong, e.g. Documents from a restricted folder shown to any employee"
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={described(errors.title && `${id}-title-error`)}
          className="h-9"
        />
        {errors.title && (
          <p id={`${id}-title-error`} className="text-xs text-destructive">
            {errors.title}
          </p>
        )}
      </div>

      <fieldset
        className="space-y-2"
        aria-describedby={described(`${id}-owasp-hint`, errors.owasp && `${id}-owasp-error`)}
      >
        <legend className="text-sm font-medium">OWASP Top 10 for LLM Applications (2025)</legend>
        <p id={`${id}-owasp-hint`} className="text-xs text-muted-foreground">
          At least one. LLM03 and LLM09 lie outside application testing, so no test covers them.
        </p>
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {OWASP_CATEGORIES.map((category) => {
            const checkbox = `${id}-owasp-${category.code}`
            const checked = form.owasp.includes(category.code)
            return (
              <div key={category.code} className="flex items-center gap-2">
                <Checkbox
                  id={checkbox}
                  checked={checked}
                  onCheckedChange={(on) =>
                    onChange({
                      owasp: on
                        ? OWASP_CATEGORIES.map((c) => c.code).filter(
                            (code) => code === category.code || form.owasp.includes(code),
                          )
                        : form.owasp.filter((code) => code !== category.code),
                    })
                  }
                />
                <label htmlFor={checkbox} className="py-1 text-sm">
                  <span className="font-mono text-xs">{category.code}</span> {category.name}
                  {!category.inScope && <span className="text-muted-foreground"> (not tested)</span>}
                </label>
              </div>
            )
          })}
        </div>
        {errors.owasp && (
          <p id={`${id}-owasp-error`} className="text-xs text-destructive">
            {errors.owasp}
          </p>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-atlas`}>MITRE ATLAS technique</Label>
          <Select value={form.atlas} onValueChange={(atlas) => onChange({ atlas })}>
            <SelectTrigger id={`${id}-atlas`} className="h-9 w-full" aria-describedby={`${id}-atlas-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None applies</SelectItem>
              {ATLAS_TECHNIQUES.map((technique) => (
                <SelectItem key={technique.code} value={technique.code}>
                  {technique.code} {technique.name}
                </SelectItem>
              ))}
              <SelectItem value="other">Another technique…</SelectItem>
            </SelectContent>
          </Select>
          <p id={`${id}-atlas-hint`} className="text-xs text-muted-foreground">
            Only where one applies (FR-3.2).
          </p>
        </div>
        {form.atlas === "other" && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-atlas-other`}>Technique ID</Label>
            <Input
              id={`${id}-atlas-other`}
              value={form.atlasOther}
              onChange={(event) => onChange({ atlasOther: event.target.value })}
              placeholder="AML.T0000"
              maxLength={20}
              className="h-9 font-mono"
              aria-invalid={errors.atlas ? true : undefined}
              aria-describedby={described(errors.atlas && `${id}-atlas-error`)}
            />
            {errors.atlas && (
              <p id={`${id}-atlas-error`} className="text-xs text-destructive">
                {errors.atlas}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-4">
        {(["likelihood", "impact"] as const).map((field) => (
          <div key={field} className="space-y-1.5">
            <Label htmlFor={`${id}-${field}`}>{field === "likelihood" ? "Likelihood" : "Impact"}</Label>
            <Select value={String(form[field])} onValueChange={(value) => onChange({ [field]: Number(value) })}>
              <SelectTrigger id={`${id}-${field}`} className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RATINGS.map((rating) => (
                  <SelectItem key={rating} value={String(rating)}>
                    {RATING_LABEL[rating]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        <p className="pb-2 text-sm">
          Risk <span className={cn("tabular font-semibold", risk >= 15 && "text-destructive")}>{risk}</span>
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-reason`}>{reasonLabel}</Label>
        <Input
          id={`${id}-reason`}
          value={form.reason}
          onChange={(event) => onChange({ reason: event.target.value })}
          maxLength={300}
          className="h-9"
          aria-describedby={`${id}-reason-hint`}
        />
        <p id={`${id}-reason-hint`} className="text-xs text-muted-foreground">
          {reasonHint}
        </p>
      </div>
    </div>
  )
}
