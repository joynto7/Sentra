"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

/** The endpoint as a chip with a button that copies it, and says that it did. */
export function EndpointChip({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success("The endpoint is copied.")
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error("It could not be copied. Select it and copy it by hand.")
    }
  }
  return (
    <p className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-[#e1e7fb] bg-white py-0.5 pr-0.5 pl-3 dark:border-white/10 dark:bg-white/5">
      <span className="min-w-0 truncate font-mono text-[13px] text-text-secondary">{url}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 rounded-full"
        onClick={() => void copy()}
        aria-label="Copy the endpoint"
      >
        {copied ? <Check className="size-3.5 text-success" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </Button>
    </p>
  )
}
