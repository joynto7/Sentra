"use client"

import Link from "next/link"
import { ArrowRight, GitPullRequest, KeyRound, ShieldCheck, Webhook, Wrench, Cloud, Rocket, CircleCheck, Server, Zap } from "lucide-react"

import { ShieldMotion } from "@/components/shield/shield-story"
import { useCan } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type Choice = "gates" | "keys" | "webhooks"

/** Three small nodes and the line between them: what goes in, the part, and what comes out. */
function Flow({ from, mid, to }: { from: React.ReactNode; mid: React.ReactNode; to: React.ReactNode }) {
  const node = "grid size-7 shrink-0 place-items-center rounded-full border bg-white text-foreground/70 dark:bg-white/10"
  const line = "ss-card-line ss-live h-0.5 flex-1 rounded-full text-primary/60"
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      <span className={node}>{from}</span>
      <span className={line} />
      <span className={cn(node, "border-primary text-primary")}>{mid}</span>
      <span className={line} />
      <span className={node}>{to}</span>
    </div>
  )
}

/**
 * Which of the three integrations does what, what each needs first and who may set it up, so the
 * choice is made before a dialog is opened. The three are links to the three pages, and the one
 * that is open is marked. It describes only what Sentra supports: a security gate for a release
 * pipeline, an API key for a tool that calls the REST API, a webhook for events sent to another
 * system. The roles come from the permission table, never from a persona.
 */
export function IntegrationsGuide({ active }: { active: Choice }) {
  const keysAndHooks = useCan("manage_api_keys_and_webhooks")
  const gates = useCan("manage_security_gates")
  const choices: {
    id: Choice
    href: string
    icon: React.ReactNode
    title: string
    line: string
    fact: string
    who: string
    flow: React.ReactNode
  }[] = [
    {
      id: "gates",
      href: "/integrations",
      icon: <GitPullRequest className="size-5" />,
      title: "Security gate",
      line: "Checks a release before it goes out.",
      fact: "Needs a target and an API key with the gate scopes.",
      who: gates ? "You can set gates up." : "A Security Analyst or a Security Manager sets them up.",
      flow: (
        <Flow from={<Rocket className="size-3.5" />} mid={<ShieldCheck className="size-3.5" />} to={<CircleCheck className="size-3.5" />} />
      ),
    },
    {
      id: "keys",
      href: "/integrations/api-keys",
      icon: <KeyRound className="size-5" />,
      title: "API key",
      line: "Lets a pipeline or tool in.",
      fact: "Only the scopes you choose. Shown once. It can never manage members, roles or other keys.",
      who: keysAndHooks ? "You can create and revoke keys." : "Only an Organization Administrator creates or revokes keys.",
      flow: <Flow from={<Wrench className="size-3.5" />} mid={<KeyRound className="size-3.5" />} to={<Server className="size-3.5" />} />,
    },
    {
      id: "webhooks",
      href: "/integrations/webhooks",
      icon: <Webhook className="size-5" />,
      title: "Webhook",
      line: "Sends events to your own system.",
      fact: "Signed, over https. It starts only after your system answers a test event.",
      who: keysAndHooks ? "You can add webhooks." : "Only an Organization Administrator adds webhooks.",
      flow: <Flow from={<Zap className="size-3.5" />} mid={<Webhook className="size-3.5" />} to={<Cloud className="size-3.5" />} />,
    },
  ]
  return (
    <section aria-labelledby="integrations-which" className="mb-5">
      <ShieldMotion />
      <h2 id="integrations-which" className="mb-2 text-[13px] font-semibold text-muted-foreground">
        Which one do I need?
      </h2>
      <ul className="grid gap-3 md:grid-cols-3">
        {choices.map((choice) => (
          <li key={choice.id}>
            <Link
              href={choice.href}
              aria-current={choice.id === active ? "page" : undefined}
              className={cn(
                "group flex h-full flex-col rounded-2xl border p-4 outline-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring",
                "bg-white bg-[linear-gradient(160deg,#e3e9ff_0%,#ffffff_70%)] dark:bg-[#151b30] dark:bg-[linear-gradient(160deg,#27346e_0%,#151b30_80%)]",
                choice.id === active
                  ? "border-primary shadow-[0_0_0_1px_var(--primary)]"
                  : "border-[#e1e7fb] hover:border-primary/50 dark:border-white/10",
              )}
            >
              <span className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#c9d2fa] text-[#1f2f80] dark:bg-[#27406f] dark:text-[#d8e4ff]"
                >
                  {choice.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{choice.title}</span>
                  <span className="block text-sm text-text-secondary">{choice.line}</span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
              <span className="mt-3 block">{choice.flow}</span>
              <span className="mt-3 block text-xs text-text-secondary">{choice.fact}</span>
              <span className="mt-1 block text-xs font-medium">{choice.who}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
