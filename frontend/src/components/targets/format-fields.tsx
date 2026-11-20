"use client"

import { FormField } from "@/components/auth/form-field"
import { TemplateEditor } from "@/components/targets/template-editor"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { RequestFormat } from "@/lib/targets"
import { cn } from "@/lib/utils"

export type FormatValue = {
  request_format: RequestFormat
  request_template: string
  reply_path: string
  tool_calls_path: string
}

const CHOICES: { value: RequestFormat; title: string; description: string }[] = [
  {
    value: "openai_chat",
    title: "OpenAI-compatible chat API (recommended)",
    description: "Sentra sends standard chat messages and reads the assistant's reply.",
  },
  {
    value: "custom_json",
    title: "Custom JSON",
    description: "Describe your request body and where the reply is.",
  },
]

/** How Sentra talks to the target (UC-2.1 step 3, NFR-7.5): used by the wizard and the edit page. */
export function FormatFields({
  value,
  onChange,
  errors,
}: {
  value: FormatValue
  onChange: (value: FormatValue) => void
  errors: Record<string, string>
}) {
  const set = (patch: Partial<FormatValue>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">How does Sentra talk to the target?</legend>
        <RadioGroup
          value={value.request_format}
          onValueChange={(v) => set({ request_format: v as RequestFormat })}
          className="grid gap-3"
        >
          {CHOICES.map((choice) => (
            <label
              key={choice.value}
              htmlFor={`format-${choice.value}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-[10px] border bg-card p-4 transition-colors hover:border-border-strong",
                value.request_format === choice.value && "border-primary bg-accent/60 ring-1 ring-primary",
              )}
            >
              <RadioGroupItem id={`format-${choice.value}`} value={choice.value} className="mt-0.5" aria-describedby={`format-${choice.value}-description`} />
              <span className="space-y-0.5">
                <span className="block text-sm font-semibold">{choice.title}</span>
                <span id={`format-${choice.value}-description`} className="block text-xs text-muted-foreground">
                  {choice.description}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>

      {value.request_format === "custom_json" && (
        <div className="space-y-5">
          <FormField id="request_template" label="Request template" error={errors.request_template}>
            <TemplateEditor
              id="request_template"
              value={value.request_template}
              onChange={(v) => set({ request_template: v })}
              invalid={!!errors.request_template}
              describedBy={errors.request_template ? "request_template-error" : "request_template-help"}
            />
            {!errors.request_template && (
              <p id="request_template-help" className="text-xs text-muted-foreground">
                The JSON body Sentra sends. It puts each message where <code className="font-mono">{"{{message}}"}</code> is, and a
                conversation ID where <code className="font-mono">{"{{session_id}}"}</code> is.
              </p>
            )}
          </FormField>
          <FormField id="reply_path" label="Reply location" error={errors.reply_path}>
            <Input
              id="reply_path"
              value={value.reply_path}
              onChange={(e) => set({ reply_path: e.target.value })}
              spellCheck={false}
              aria-invalid={!!errors.reply_path || undefined}
              aria-describedby={errors.reply_path ? "reply_path-error" : "reply_path-help"}
              className="h-9 font-mono text-[13px]"
            />
            {!errors.reply_path && (
              <p id="reply_path-help" className="text-xs text-muted-foreground">
                JSONPath to the text of the reply, for example <code className="font-mono">$.output.text</code>.
              </p>
            )}
          </FormField>
          <FormField id="tool_calls_path" label="Tool calls location (optional)" error={errors.tool_calls_path}>
            <Input
              id="tool_calls_path"
              value={value.tool_calls_path}
              onChange={(e) => set({ tool_calls_path: e.target.value })}
              spellCheck={false}
              aria-invalid={!!errors.tool_calls_path || undefined}
              aria-describedby={errors.tool_calls_path ? "tool_calls_path-error" : "tool_calls_path-help"}
              className="h-9 font-mono text-[13px]"
            />
            {!errors.tool_calls_path && (
              <p id="tool_calls_path-help" className="text-xs text-muted-foreground">
                Lets Sentra inspect which tools the agent calls.
              </p>
            )}
          </FormField>
        </div>
      )}
    </div>
  )
}
