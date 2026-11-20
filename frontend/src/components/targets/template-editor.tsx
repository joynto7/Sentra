"use client"

import { useRef } from "react"

import { cn } from "@/lib/utils"

const PLACEHOLDER = /(\{\{\s*\w+\s*\}\})/g

/**
 * The custom request template (UC-2.1 step 3): a monospace text box with line numbers, and
 * placeholders such as {{message}} highlighted. The highlighting is a copy drawn behind the
 * transparent text box, so typing, pasting and screen readers use an ordinary textarea.
 */
export function TemplateEditor({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
}) {
  const backdrop = useRef<HTMLPreElement>(null)
  const lines = Math.max(4, value.split("\n").length)

  return (
    <div
      className={cn(
        "relative flex overflow-hidden rounded-[7px] border border-input bg-card font-mono text-[13px] leading-6",
        invalid && "border-destructive",
      )}
    >
      <div aria-hidden="true" className="shrink-0 border-r bg-muted px-2 py-2 text-right text-muted-foreground select-none">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <pre
          ref={backdrop}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-0 overflow-hidden px-3 py-2 break-all whitespace-pre-wrap text-foreground"
        >
          {value.split(PLACEHOLDER).map((part, i) =>
            i % 2 === 1 ? (
              <mark key={i} className="rounded-sm bg-accent text-accent-foreground">
                {part}
              </mark>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
          {"\n"}
        </pre>
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop
          }}
          rows={lines}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="relative block w-full resize-y bg-transparent px-3 py-2 break-all whitespace-pre-wrap text-transparent caret-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset selection:bg-primary/25 selection:text-transparent"
        />
      </div>
    </div>
  )
}
