import { ListChecks, Rocket, ShieldCheck, Target, UserCheck, Wrench, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const STEPS: { icon: LucideIcon; title: string; what: string; you?: string }[] = [
  { icon: Target, title: "Check the target", what: "Verified, and its profile mapped and reviewed." },
  {
    icon: ShieldCheck,
    title: "Threat model",
    what: "Sentra's AI suggests the threats that apply to it.",
    you: "You approve it",
  },
  { icon: ListChecks, title: "Campaign", what: "Every test that applies, inside the safe rate and a budget." },
  {
    icon: Rocket,
    title: "Run",
    what: "The tests are sent and every reply is judged.",
    you: "Scope approval, where required",
  },
  {
    icon: Wrench,
    title: "Remediation",
    what: "A proposed fix is drafted for the worst findings.",
    you: "You approve every fix",
  },
]

/** The whole assessment in one line, so a person knows what the autopilot will do and where it stops for them. */
export function AutopilotHero() {
  return (
    <section
      aria-labelledby="how-heading"
      className="ap-rise relative overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="how-heading" className="text-base font-semibold">
            How an assessment goes
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
            <UserCheck className="size-3.5" aria-hidden="true" />
            You stay in charge of every approval
          </span>
        </div>
        <ol className="relative mt-6 grid gap-6 md:grid-cols-5 md:gap-4">
          <span
            aria-hidden="true"
            className="ap-grow-x absolute top-5 right-[10%] left-[10%] hidden h-0.5 rounded-full bg-primary/25 md:block"
          />
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="ap-rise relative flex gap-4 md:flex-col md:items-center md:text-center"
              style={{ "--i": index + 1 } as React.CSSProperties}
            >
              <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-full border-2 border-primary/30 bg-card text-primary shadow-sm">
                <step.icon className="size-5" aria-hidden="true" />
                <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  {index + 1}
                </span>
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{step.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.what}</p>
                {step.you && (
                  <p
                    className={cn(
                      "mt-2 inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning",
                    )}
                  >
                    <UserCheck className="size-3.5" aria-hidden="true" />
                    {step.you}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
