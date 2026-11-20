"use client"

import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { DETECTION_LABEL, type RuleCheck, type SuccessRule } from "@/lib/test-library"

export const MAX_RULES = 8

// What the user fills in for each kind of check.
const VALUE_FIELD: Record<string, { label: string; placeholder: string }> = {
  tool: { label: "Tool name", placeholder: "issue_refund" },
  text: { label: "Text in the reply", placeholder: "REF-0000" },
  number: { label: "Number of tool calls", placeholder: "20" },
  statement: { label: "What the judge confirms", placeholder: "The reply promises a refund without checking the policy." },
}

/**
 * The success-condition builder of Screen 31 (UC-4.2 step 3). Each rule is one check, done by the
 * detection method named above it, e.g. "Tool call to [issue_refund] happens without a confirmation
 * step in the same conversation".
 */
export function RuleBuilder({
  rules,
  checks,
  errorFor,
  onChange,
}: {
  rules: SuccessRule[]
  checks: RuleCheck[]
  errorFor: (field: string) => string | undefined
  onChange: (rules: SuccessRule[]) => void
}) {
  const update = (index: number, change: Partial<SuccessRule>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...change } : rule)))

  return (
    <div className="space-y-3">
      {rules.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No rules yet. Add a rule for each thing that shows the test succeeded.
        </p>
      )}
      <ol className="space-y-3">
        {rules.map((rule, index) => {
          const check = checks.find((c) => c.check === rule.check)
          const field = check ? VALUE_FIELD[check.value] : undefined
          const number = index + 1
          const error = errorFor(`success_rules.${index}`)
          const errorId = `rule-${index}-error`
          return (
            <li key={index} className="rounded-[10px] border bg-muted/40 p-3">
              <div role="group" aria-labelledby={`rule-${index}-title`} className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 id={`rule-${index}-title`} className="text-xs font-semibold text-text-secondary">
                    Rule {number}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · checked by {check ? DETECTION_LABEL[check.method] : "…"}
                    </span>
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Remove rule ${number}`}
                    onClick={() => onChange(rules.filter((_, i) => i !== index))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`rule-${index}-check`} className="sr-only">
                    Check of rule {number}
                  </Label>
                  <Select value={rule.check} onValueChange={(value) => update(index, { check: value, value: "" })}>
                    <SelectTrigger id={`rule-${index}-check`} className="h-auto min-h-9 w-full text-left whitespace-normal">
                      <SelectValue placeholder="Choose a check" />
                    </SelectTrigger>
                    <SelectContent>
                      {checks.map((c) => (
                        <SelectItem key={c.check} value={c.check} className="whitespace-normal">
                          {c.sentence.replace('"{value}"', "…").replace("{value}", "…")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {field && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`rule-${index}-value`} className="text-xs">
                      {field.label}
                    </Label>
                    {check?.value === "statement" ? (
                      <Textarea
                        id={`rule-${index}-value`}
                        value={rule.value}
                        onChange={(e) => update(index, { value: e.target.value })}
                        placeholder={field.placeholder}
                        rows={2}
                        aria-invalid={!!error || undefined}
                        aria-describedby={error ? errorId : undefined}
                      />
                    ) : (
                      <Input
                        id={`rule-${index}-value`}
                        value={rule.value}
                        onChange={(e) => update(index, { value: e.target.value })}
                        placeholder={field.placeholder}
                        inputMode={check?.value === "number" ? "numeric" : undefined}
                        className={check?.value === "tool" ? "h-9 font-mono text-[13px] sm:w-72" : "h-9 sm:w-72"}
                        aria-invalid={!!error || undefined}
                        aria-describedby={error ? errorId : undefined}
                      />
                    )}
                  </div>
                )}
                {error && (
                  <p id={errorId} className="text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <Button
        type="button"
        variant="outline"
        className="h-9"
        disabled={rules.length >= MAX_RULES}
        onClick={() => onChange([...rules, { check: "", value: "" }])} // the user chooses the check
      >
        <Plus aria-hidden="true" />
        Add rule
      </Button>
      {rules.length >= MAX_RULES && <p className="text-xs text-muted-foreground">A test can have up to {MAX_RULES} rules.</p>}
    </div>
  )
}
