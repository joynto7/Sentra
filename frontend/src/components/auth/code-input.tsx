"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"

const LENGTH = 6

/**
 * Six boxes for the 6-digit code (Screen 02), drawn over one real input. One input means one
 * label ("Verification code") for screen readers, pasting a whole code fills all six boxes, and
 * phones and password managers can fill it in (autocomplete "one-time-code").
 */
export function CodeInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  ref,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
  ref?: React.Ref<HTMLInputElement>
}) {
  const [focused, setFocused] = useState(false)
  const active = Math.min(value.length, LENGTH - 1)

  return (
    <div className="relative w-fit">
      <div className="flex gap-2" aria-hidden="true">
        {Array.from({ length: LENGTH }, (_, i) => (
          <div
            key={i}
            className={cn(
              "flex h-12 w-11 items-center justify-center rounded-[7px] border bg-card font-mono text-xl font-medium",
              invalid ? "border-destructive" : "border-input",
              focused && i === active && "border-ring ring-2 ring-ring/40",
            )}
          >
            {value[i] ?? ""}
          </div>
        ))}
      </div>
      {/* The real field covers the boxes; its text is transparent, its focus ring stays visible. */}
      <input
        ref={ref}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="absolute -inset-1 rounded-[10px] bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )
}
