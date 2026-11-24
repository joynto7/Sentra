import { Bot, Cloud, HardDrive, MessageCircle, Scale, ShieldCheck, Wrench, type LucideIcon } from "lucide-react"

import type { Provider, ProviderKind } from "@/lib/llm-providers"
import { cn } from "@/lib/utils"

/** What each task of Sentra's own AI is for, in a sentence, and the order a person meets them in. */
export const TASK_INFO: Record<string, { icon: LucideIcon; summary: string }> = {
  threat_modeling: {
    icon: ShieldCheck,
    summary: "Suggests the threats that apply to a target, before any test is sent.",
  },
  adaptive_testing: {
    icon: Bot,
    summary: "Writes follow-up attempts from a target's replies, inside the approved limits.",
  },
  llm_judge: {
    icon: Scale,
    summary: "Helps decide whether a reply shows that an attack worked.",
  },
  remediation: {
    icon: Wrench,
    summary: "Drafts the proposed fix for a finding. A person approves it.",
  },
  assistant: {
    icon: MessageCircle,
    summary: "The chat that guides people and does their work for them.",
  },
}
export const TASK_ORDER = ["threat_modeling", "adaptive_testing", "llm_judge", "remediation", "assistant"]

/** External or local, in one chip: whether an organization's data leaves the platform. */
export function Location({ deployment, className }: { deployment: "external" | "local"; className?: string }) {
  const local = deployment === "local"
  const Icon = local ? HardDrive : Cloud
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        local ? "border-success/30 bg-success/10 text-success" : "border-border bg-muted/50 text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {local ? "Stays local" : "External"}
    </span>
  )
}

const AVATAR: Record<ProviderKind, string> = {
  anthropic: "from-[#d97757] to-[#b45309]",
  openai: "from-[#10a37f] to-[#0f766e]",
  ollama: "from-[#475569] to-[#1e293b]",
  openai_compatible: "from-[#6366f1] to-[#8b5cf6]",
}

/** A monogram on a colour of the provider's own, so a card and the task that uses it look related. */
export function ProviderAvatar({
  name,
  kind,
  size = "md",
}: {
  name: string
  kind: ProviderKind
  size?: "sm" | "md"
}) {
  const google = kind === "openai_compatible" && /gemini|google/i.test(name)
  const gradient = google ? "from-[#4285f4] to-[#9b72cb]" : AVATAR[kind]
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-xl bg-gradient-to-br font-semibold text-white shadow-sm",
        gradient,
        size === "md" ? "size-10 text-base" : "size-6 rounded-md text-xs",
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  )
}

export type Health = "working" | "failed" | "untested"

/** How a provider stands, from its last test request: the word is always written beside the colour. */
export function healthOf(provider: Provider | undefined): Health {
  if (!provider || !provider.tested_at) return "untested"
  return provider.test_duration_ms === null ? "failed" : "working"
}

export const HEALTH_WORD: Record<Health, string> = {
  working: "Working",
  failed: "Last test failed",
  untested: "Not tested yet",
}

export function HealthDot({ health }: { health: Health }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        health === "working" && "bg-success",
        health === "failed" && "bg-destructive",
        health === "untested" && "bg-muted-foreground/50",
      )}
    />
  )
}
