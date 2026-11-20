"use client"

import { FileSearch, MessagesSquare, Workflow } from "lucide-react"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { TYPE_DESCRIPTION, TYPE_LABEL, type TargetType } from "@/lib/targets"
import { cn } from "@/lib/utils"

const ICONS = { chatbot: MessagesSquare, rag_application: FileSearch, tool_using_agent: Workflow }

/** "What kind of AI application is it?" (UC-2.1 step 1): three cards with a visible radio. */
export function TypeCards({
  value,
  onChange,
  error,
}: {
  value: TargetType | ""
  onChange: (value: TargetType) => void
  error?: string
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">What kind of AI application is it?</legend>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as TargetType)}
        aria-describedby={error ? "type-error" : undefined}
        aria-invalid={!!error || undefined}
        className="grid gap-3 sm:grid-cols-3"
      >
        {(Object.keys(TYPE_LABEL) as TargetType[]).map((type) => {
          const Icon = ICONS[type]
          return (
            <label
              key={type}
              htmlFor={`type-${type}`}
              className={cn(
                "relative flex cursor-pointer flex-col gap-2 rounded-[10px] border bg-card p-4 transition-colors hover:border-border-strong",
                value === type && "border-primary bg-accent/60 ring-1 ring-primary",
              )}
            >
              <span className="flex items-start justify-between gap-3">
                <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                <RadioGroupItem id={`type-${type}`} value={type} aria-describedby={`type-${type}-description`} />
              </span>
              <span className="text-sm font-semibold">{TYPE_LABEL[type]}</span>
              <span id={`type-${type}-description`} className="text-xs text-muted-foreground">
                {TYPE_DESCRIPTION[type]}
              </span>
            </label>
          )
        })}
      </RadioGroup>
      {error && (
        <p id="type-error" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}
