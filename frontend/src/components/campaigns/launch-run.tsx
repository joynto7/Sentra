"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Rocket } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ApiError } from "@/lib/api"
import { launchRun } from "@/lib/campaigns"
import { useCan } from "@/lib/permissions"

/**
 * UC-5.3 Launch Campaign: the API answers at once with the new run and the workers execute it,
 * so the button takes the user straight to the live monitor (UC-5.6 trigger). Only a Security
 * Analyst may launch (FR-1.6), and only against a verified target (FR-5.7).
 */
export function LaunchRunButton({
  code,
  targetVerified,
  className,
  size = "default",
}: {
  code: string
  targetVerified: boolean
  className?: string
  size?: "default" | "sm"
}) {
  const router = useRouter()
  const canLaunch = useCan("manage_campaigns")
  const [busy, setBusy] = useState(false)
  if (!canLaunch) return null

  async function launch() {
    setBusy(true)
    try {
      const run = await launchRun(code)
      toast.success(`${run.code} started`, { description: "The workers are running it now." })
      router.push(`/campaigns/${code}/runs/${run.number}`)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The run could not be started.")
      setBusy(false)
    }
  }

  const button = (
    <Button
      className={className ?? "h-9 gap-1.5 hover:bg-primary-hover"}
      size={size}
      disabled={busy || !targetVerified}
      onClick={() => void launch()}
    >
      <Rocket aria-hidden="true" />
      {busy ? "Starting…" : "Launch run"}
    </Button>
  )

  if (targetVerified) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>Verify the target&apos;s ownership first; only a verified target can be tested.</TooltipContent>
    </Tooltip>
  )
}
