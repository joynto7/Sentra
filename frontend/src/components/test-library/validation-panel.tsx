"use client"

import { CircleAlert, CircleCheck, CircleDashed, CircleX, Lock } from "lucide-react"

import type { CheckResult } from "@/lib/test-library"

/** The names of the fields, as the form shows them. */
export const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  category: "Category",
  objective: "Objective",
  prerequisites: "Prerequisites",
  target_types: "Applicable target types",
  attempt_template: "How attempts are built",
  success_rules: "Success condition",
  success_condition: "Success condition in words",
  detection_methods: "Detection methods",
  severity: "Severity",
  recommended_mitigation: "Recommended mitigation",
  atlas: "MITRE ATLAS techniques",
  file: "Definition file",
  reason: "Reason for the change",
}

/**
 * The "Validation" panel of Screen 31, updated while the user types: the schema, the three content
 * rules (NFR-9.1) and who will see the test (FR-4.3). Each problem jumps to its field.
 */
export function ValidationPanel({
  result,
  checking,
  pendingRules,
  organization,
  onShowField,
}: {
  result: CheckResult | null
  checking: boolean
  pendingRules: string[]
  organization: string
  onShowField: (field: string) => void
}) {
  const problems = result?.errors ?? []
  const broken = result?.rules.filter((r) => !r.ok && !pendingRules.includes(r.id)) ?? []
  const summary = !result
    ? "Checking the definition"
    : problems.length || broken.length
      ? `${problems.length} schema problem${problems.length === 1 ? "" : "s"}, ${broken.length} content rule${broken.length === 1 ? "" : "s"} broken`
      : "The definition is valid"

  return (
    <aside aria-labelledby="validation-heading" className="space-y-4 rounded-[10px] border bg-card p-5 lg:sticky lg:top-6">
      <div>
        <h2 id="validation-heading" className="text-[15px] font-semibold">
          Validation
        </h2>
        <p className="text-xs text-muted-foreground">{checking ? "Checking…" : "Updated as you type."}</p>
        <p className="sr-only" aria-live="polite">
          {checking ? "" : summary}
        </p>
      </div>

      <section aria-labelledby="schema-heading" className="space-y-1.5">
        <h3 id="schema-heading" className="text-sm font-medium">
          Schema
        </h3>
        {!result ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : problems.length === 0 ? (
          <p className="flex items-center gap-2 text-sm">
            <CircleCheck className="size-4 text-success" aria-hidden="true" />
            Valid
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm">
              <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
              {problems.length} {problems.length === 1 ? "field needs" : "fields need"} attention
            </p>
            <ul className="space-y-1 pl-6">
              {problems.map((problem) => (
                <li key={problem.field + problem.message} className="text-xs">
                  <button
                    type="button"
                    className="text-left text-link underline-offset-2 hover:underline"
                    onClick={() => onShowField(problem.field)}
                  >
                    {FIELD_LABEL[problem.field.split(".")[0]] ?? problem.field}
                  </button>
                  <span className="text-muted-foreground">: {problem.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="rules-heading" className="space-y-1.5">
        <h3 id="rules-heading" className="text-sm font-medium">
          Content rules
        </h3>
        <ul className="space-y-1.5">
          {(result?.rules ?? []).map((rule) => {
            const pending = pendingRules.includes(rule.id)
            const Icon = pending ? CircleDashed : rule.ok ? CircleCheck : CircleX
            const color = pending ? "text-muted-foreground" : rule.ok ? "text-success" : "text-destructive"
            return (
              <li key={rule.id} className="text-sm">
                <span className="flex items-start gap-2">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden="true" />
                  <span>
                    {rule.label}
                    <span className="sr-only">{pending ? ": not checked yet" : rule.ok ? ": met" : ": broken"}</span>
                  </span>
                </span>
                {!pending && !rule.ok && rule.field && (
                  <button
                    type="button"
                    className="mt-0.5 ml-6 text-left text-xs text-link underline-offset-2 hover:underline"
                    onClick={() => onShowField(rule.field)}
                  >
                    Go to {FIELD_LABEL[rule.field.split(".")[0]] ?? rule.field}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="visibility-heading" className="space-y-1.5">
        <h3 id="visibility-heading" className="text-sm font-medium">
          Visibility
        </h3>
        <p className="flex items-center gap-2 text-sm">
          <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
          {organization} only
        </p>
      </section>
    </aside>
  )
}
