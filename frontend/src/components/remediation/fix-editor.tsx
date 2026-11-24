"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { EnforcementChip } from "@/components/remediation/badges"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api"
import {
  DETAIL_KEY,
  DETAIL_TITLE,
  type Fix,
  type FixEdit,
  type RemediationVersion,
  adaptRemediation,
} from "@/lib/remediation"

/** What a person may change about one fix (UC-8.3 step 2). */
type Draft = { kept: boolean; title: string; description: string; detail: DetailDraft }
/** The body of a fix: one text for a prompt, lines for a list, fields for a list of rules. */
type DetailDraft =
  | { shape: "text"; key: string; text: string }
  | { shape: "lines"; key: string; text: string }
  | { shape: "fields"; key: string; rows: Record<string, string>[] }

function detailDraft(fix: Fix): DetailDraft {
  const key = DETAIL_KEY[fix.kind]
  const value = fix.details[key]
  if (key === "prompt") return { shape: "text", key, text: typeof value === "string" ? value : "" }
  const list = Array.isArray(value) ? value : []
  if (list.every((one) => typeof one === "string")) {
    return { shape: "lines", key, text: (list as string[]).join("\n") }
  }
  return {
    shape: "fields",
    key,
    rows: list.map((one) =>
      Object.fromEntries(
        Object.entries(one as Record<string, unknown>).map(([name, text]) => [name, String(text)]),
      ),
    ),
  }
}

function details(draft: DetailDraft): Record<string, unknown> {
  if (draft.shape === "text") return { [draft.key]: draft.text.trim() }
  if (draft.shape === "lines") {
    return {
      [draft.key]: draft.text
        .split("\n")
        .map((one) => one.trim())
        .filter(Boolean),
    }
  }
  return {
    [draft.key]: draft.rows.filter((row) => Object.values(row).some((one) => one.trim())),
  }
}

/** The body of a fix while it is being changed, by the shape its kind has. */
function DetailFields({
  fix,
  draft,
  onChange,
}: {
  fix: Fix
  draft: DetailDraft
  onChange: (next: DetailDraft) => void
}) {
  const id = `fix-${fix.position}-detail`
  if (draft.shape === "fields") {
    return (
      <ul className="mt-1 space-y-2">
        {draft.rows.map((row, index) => (
          <li key={index} className="flex flex-wrap gap-2">
            {Object.entries(row).map(([name, value]) => (
              <span key={name} className="min-w-[12rem] flex-1 space-y-1">
                <Label
                  htmlFor={`${id}-${index}-${name}`}
                  className="text-xs font-normal text-muted-foreground capitalize"
                >
                  {name}
                </Label>
                <Input
                  id={`${id}-${index}-${name}`}
                  value={value}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      rows: draft.rows.map((one, at) =>
                        at === index ? { ...one, [name]: event.target.value } : one,
                      ),
                    })
                  }
                />
              </span>
            ))}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <Textarea
      id={id}
      className="mt-1 font-mono text-[13px]"
      rows={draft.shape === "text" ? 5 : Math.min(8, draft.text.split("\n").length + 1)}
      value={draft.text}
      aria-describedby={draft.shape === "lines" ? `${id}-help` : undefined}
      onChange={(event) => onChange({ ...draft, text: event.target.value })}
    />
  )
}

/**
 * UC-8.3 steps 2-3: the developer adapts the proposal to their application — a clearer sentence,
 * a rule that lets their legitimate requests through, a fix that does not apply at all — and
 * saving it writes the next version and asks the approvers to look at it. The kind of a fix and
 * where it is enforced stay Sentra's (UC-8.2 step 6), so they cannot be changed here; a fix that
 * is wrong for the application is removed instead.
 */
export function ProposalEditor({
  code,
  current,
  onCancel,
  onSaved,
}: {
  code: string
  current: RemediationVersion
  onCancel: () => void
  onSaved: () => void
}) {
  const [rootCause, setRootCause] = useState(current.root_cause)
  const [summary, setSummary] = useState(current.summary)
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(
      current.fixes.map((fix) => [
        fix.position,
        {
          kept: true,
          title: fix.title,
          description: fix.description,
          detail: detailDraft(fix),
        },
      ]),
    ),
  )
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>()

  const kept = current.fixes.filter((fix) => drafts[fix.position]?.kept)

  // The edit lives only in this page: nothing is kept anywhere until it is saved as the next version
  // (the content can hold a system prompt, so it is not copied to browser storage). Leaving or
  // reloading with unsaved changes asks first.
  const dirty =
    rootCause !== current.root_cause ||
    summary !== current.summary ||
    current.fixes.some((fix) => {
      const draft = drafts[fix.position]
      return !draft?.kept || draft.title !== fix.title || draft.description !== fix.description || JSON.stringify(draft.detail) !== JSON.stringify(detailDraft(fix))
    })
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  function change(position: number, next: Partial<Draft>) {
    setDrafts((before) => ({ ...before, [position]: { ...before[position], ...next } }))
  }

  async function save() {
    if (kept.length === 0) {
      return setProblem("Keep at least one fix, or ask Sentra for a new proposal instead.")
    }
    const fixes: FixEdit[] = kept.map((fix) => {
      const draft = drafts[fix.position]
      return {
        position: fix.position,
        title: draft.title.trim(),
        description: draft.description.trim(),
        details: details(draft.detail),
      }
    })
    if (fixes.some((fix) => !fix.title || !fix.description)) {
      return setProblem("Every fix needs a title and a sentence that says what it changes.")
    }
    setBusy(true)
    setProblem(undefined)
    try {
      const made = await adaptRemediation(code, current.version, {
        root_cause: rootCause.trim(),
        summary: summary.trim(),
        fixes,
      })
      toast.success(`Version ${made.version} is with the approvers.`, {
        description: "A proposal you adapted has to be approved by somebody else.",
      })
      onSaved()
    } catch (failed) {
      setProblem(
        failed instanceof ApiError ? failed.message : "The version could not be saved. Try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="editor" className="space-y-4">
      <div className="rounded-[10px] border bg-card p-4">
        <h2 id="editor" className="text-[15px] font-semibold">
          Adapt version {current.version}
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Your changes are saved as version {current.version + 1} and go to the approvers at once.
          Version {current.version} stays as it is. Nothing is saved until you press the button below, and saving
          applies nothing: the new version still needs somebody else&apos;s approval. {dirty ? "You have unsaved changes." : ""} The kind of a fix and where it takes effect are
          Sentra&apos;s; remove a fix that does not apply to your application.
        </p>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="root-cause">Root cause</Label>
          <Textarea
            id="root-cause"
            rows={3}
            value={rootCause}
            onChange={(event) => setRootCause(event.target.value)}
          />
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="summary">What the fixes do</Label>
          <Textarea
            id="summary"
            rows={2}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>
      </div>

      <ol className="space-y-3">
        {current.fixes.map((fix) => {
          const draft = drafts[fix.position]
          if (!draft) return null
          return (
            <li
              key={fix.position}
              className={`rounded-[10px] border p-4 ${
                draft.kept ? "bg-card" : "border-dashed bg-muted/30"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular text-xs text-muted-foreground">{fix.position}</span>
                <span className="rounded-md border border-border-strong px-2 py-0.5 text-xs text-text-secondary">
                  {fix.kind_label}
                </span>
                <EnforcementChip enforcement={fix.enforcement} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto h-8"
                  aria-label={`${draft.kept ? "Remove" : "Keep"} fix ${fix.position}: ${fix.title}`}
                  onClick={() => change(fix.position, { kept: !draft.kept })}
                >
                  {draft.kept ? "Remove this fix" : "Keep it after all"}
                </Button>
              </div>
              {draft.kept ? (
                <div className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`fix-${fix.position}-title`}>Title</Label>
                    <Input
                      id={`fix-${fix.position}-title`}
                      value={draft.title}
                      maxLength={200}
                      onChange={(event) => change(fix.position, { title: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`fix-${fix.position}-description`}>
                      What it changes, in plain language
                    </Label>
                    <Textarea
                      id={`fix-${fix.position}-description`}
                      rows={2}
                      value={draft.description}
                      onChange={(event) =>
                        change(fix.position, { description: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`fix-${fix.position}-detail`}>{DETAIL_TITLE[fix.kind]}</Label>
                    <DetailFields
                      fix={fix}
                      draft={draft.detail}
                      onChange={(next) => change(fix.position, { detail: next })}
                    />
                    {draft.detail.shape === "lines" && (
                      <p
                        id={`fix-${fix.position}-detail-help`}
                        className="text-xs text-muted-foreground"
                      >
                        One per line.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-muted-foreground">
                  “{fix.title}” is left out of version {current.version + 1}.
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-9 hover:bg-primary-hover" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save and request approval"}
        </Button>
        <Button variant="outline" className="h-9" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-[13px] text-muted-foreground">
          {kept.length} of {current.fixes.length} fixes kept
        </span>
      </div>
    </section>
  )
}
