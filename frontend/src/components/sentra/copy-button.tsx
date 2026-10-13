"use client"

import { useEffect, useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Copies a text, then says "Copied" for a moment. The result is announced to screen readers
 * through a polite live region, so the button keeps its name.
 */
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  description,
  className,
}: {
  text: string
  label?: string
  copiedLabel?: string
  /** The accessible name when the visible label alone is unclear, e.g. "Copy the key". */
  description?: string
  className?: string
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")

  useEffect(() => {
    if (state === "idle") return
    const timer = setTimeout(() => setState("idle"), 2500)
    return () => clearTimeout(timer)
  }, [state])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState("copied")
    } catch {
      setState("failed")
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className ?? "h-8 gap-1.5"}
        onClick={copy}
        aria-label={state === "idle" ? description : undefined}
      >
        {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {state === "copied" ? copiedLabel : state === "failed" ? "Copy failed" : label}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? copiedLabel : state === "failed" ? "Copying didn't work. Select the text and copy it." : ""}
      </span>
    </>
  )
}
