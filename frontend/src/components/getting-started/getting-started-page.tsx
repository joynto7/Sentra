"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  Check,
  CircleCheck,
  Clock,
  FlaskConical,
  Gauge,
  Lock,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Target,
  UserPlus,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"

import { InviteDialog } from "@/components/admin/invite-dialog"
import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { useSession } from "@/components/session-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { type FirstSteps, getFirstSteps } from "@/lib/getting-started"
import { firstName } from "@/lib/members"
import { useCan } from "@/lib/permissions"
import { cn } from "@/lib/utils"

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
const LOOP = [
  { icon: Target, label: "Register" },
  { icon: ShieldCheck, label: "Verify" },
  { icon: Rocket, label: "Test" },
  { icon: Wrench, label: "Fix" },
  { icon: RefreshCw, label: "Retest" },
]
const RULES = [
  { icon: CircleCheck, text: "Only targets you own or are authorized to test" },
  { icon: RefreshCw, text: "Ownership is re-checked before every campaign run" },
  { icon: Gauge, text: "Every run has a budget, a rate limit and an emergency stop" },
]

type Step = {
  key: FirstSteps["done"][number]
  title: string
  description: string
  minutes?: number
  done: boolean
  doneText?: string
  /** Why the step can't be taken yet, e.g. "Available after step 3" */
  locked?: string
  /** What this member can do for the step; empty when another role takes it */
  actions?: React.ReactNode
  /** Who takes the step when this member's role can't (FR-1.6) */
  who?: string
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

function when(iso: string) {
  const date = new Date(iso)
  return date.toDateString() === new Date().toDateString() ? "today" : `on ${DAY.format(date)}`
}

function StepRow({ step, number, next }: { step: Step; number: number; next: boolean }) {
  return (
    <li className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:gap-4" aria-current={next ? "step" : undefined}>
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold",
            step.done && "border-success bg-success text-white",
            !step.done && !step.locked && "border-primary text-link",
            !step.done && step.locked && "border-border-strong text-muted-foreground",
          )}
          aria-hidden="true"
        >
          {step.done ? <Check className="size-4" /> : number}
        </span>
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] font-semibold">
            <span>
              <span className="sr-only">Step {number}: </span>
              {step.title}
              {step.done && <span className="sr-only">, done</span>}
            </span>
            {!step.done && step.minutes && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <Clock className="size-3.5" aria-hidden="true" />
                {step.minutes} min
              </span>
            )}
          </h3>
          <p className="text-sm text-text-secondary">{step.done ? step.doneText : step.description}</p>
          {!step.done && !step.locked && step.who && <p className="mt-1 text-sm text-muted-foreground">{step.who}</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1.5 pl-12 sm:items-end sm:pl-0">
        {step.done ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
            <CircleCheck className="size-4" aria-hidden="true" />
            Done
          </span>
        ) : step.locked ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {step.locked}
          </span>
        ) : (
          <div className="flex flex-wrap gap-2 sm:justify-end">{step.actions}</div>
        )}
      </div>
    </li>
  )
}

/**
 * Screen 07: the first-run home of an organization (UC-1.6 step 6, UC-7.3 2a). Five steps lead
 * to a first campaign within about 15 minutes (NFR-4.1). Each step shows its action only to the
 * roles that may take it, and says who takes it otherwise (FR-1.6); a step that has to wait says
 * which step it waits for.
 */
export function GettingStartedPage() {
  const session = useSession()
  const organization = session.organization?.name ?? "your organization"
  usePageCrumbs([{ label: organization }, { label: "Getting Started" }])
  const canInvite = useCan("manage_members")
  const canRegister = useCan("manage_targets")
  const canVerify = useCan("verify_targets")
  const canCampaign = useCan("manage_campaigns")
  const canLab = useCan("use_security_lab")
  const [steps, setSteps] = useState<FirstSteps | null>(null)
  const [failed, setFailed] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [inviting, setInviting] = useState<string | null>(null) // the role chosen in advance

  useEffect(() => {
    let current = true
    getFirstSteps()
      .then((found) => {
        if (!current) return
        setSteps(found)
        setFailed(false)
      })
      .catch(() => current && setFailed(true))
    return () => {
      current = false
    }
  }, [reloads])

  const done = new Set(steps?.done ?? [])
  const invite = (role: string, label: string, icon = true) => (
    <Button variant="outline" className="h-9 gap-1.5" onClick={() => setInviting(role)}>
      {icon && <UserPlus aria-hidden="true" />}
      {label}
    </Button>
  )

  const list: Step[] = steps
    ? [
        {
          key: "organization",
          title: "Create your organization",
          description: "",
          done: true,
          doneText: `${steps.organization} was created ${when(steps.created_at)}${steps.created_by ? ` by ${steps.created_by}` : ""}.`,
        },
        {
          key: "team",
          title: "Invite your team",
          description: "Add analysts, developers and managers with the right roles.",
          minutes: 2,
          done: done.has("team"),
          doneText: [
            steps.members > 1 ? plural(steps.members, "member", "members") : "",
            steps.open_invitations ? `${plural(steps.open_invitations, "invitation", "invitations")} open` : "",
          ]
            .filter(Boolean)
            .join(" · ")
            .concat("."),
          actions: canInvite ? invite("", "Invite members") : null,
          who: canInvite ? undefined : "Your Organization Administrator invites members.",
        },
        {
          key: "target",
          title: "Add something to test",
          description: "Register an AI application you own, or deploy a lab target to practise safely.",
          minutes: 5,
          done: done.has("target"),
          doneText: steps.first_target ? `${steps.first_target.name} is registered.` : "",
          actions: (
            <>
              {canLab && (
                <Button asChild variant="outline" className="h-9 gap-1.5">
                  <Link href="/lab">
                    <FlaskConical aria-hidden="true" />
                    Deploy a lab target
                  </Link>
                </Button>
              )}
              {canRegister && (
                <Button asChild className="h-9 gap-1.5 hover:bg-primary-hover">
                  <Link href="/targets/new">
                    <Plus aria-hidden="true" />
                    Register target
                  </Link>
                </Button>
              )}
              {!canRegister && canInvite && invite("target_owner", "Invite a developer")}
            </>
          ),
          who: canRegister ? undefined : "AI Application Developers register the organization's targets.",
        },
        {
          key: "verification",
          title: "Verify ownership",
          description: "Publish a token on your domain so Sentra is allowed to test it.",
          minutes: 3,
          done: done.has("verification"),
          doneText: steps.verified_target ? `${steps.verified_target.name} is verified.` : "",
          locked: done.has("target") ? undefined : "Available after step 3",
          actions:
            canVerify && steps.unverified_target ? (
              <Button asChild className="h-9 gap-1.5 hover:bg-primary-hover">
                <Link href={`/targets/${steps.unverified_target.id}`}>
                  <ShieldCheck aria-hidden="true" />
                  Verify ownership
                </Link>
              </Button>
            ) : null,
          who: canVerify ? undefined : "The target's AI Application Developer verifies it.",
        },
        {
          key: "campaign_run",
          title: "Run your first campaign",
          description: "Start with the recommended Quick Regression suite.",
          minutes: 5,
          done: steps.campaign_run_finished,
          doneText: "Your first campaign run has finished.",
          locked: done.has("verification") ? undefined : "Available after step 4",
          actions: (
            <>
              {canCampaign && steps.verified_target && (
                <Button asChild className="h-9 gap-1.5 hover:bg-primary-hover">
                  <Link href={`/campaigns/new?target=${steps.verified_target.id}&suite=QUICK-REGRESSION`}>
                    <Rocket aria-hidden="true" />
                    Launch campaign
                  </Link>
                </Button>
              )}
              {!canCampaign && canInvite && invite("security_analyst", "Invite an analyst")}
            </>
          ),
          who: canCampaign ? undefined : "Security Analysts run the organization's campaigns.",
        },
      ]
    : []
  const count = list.filter((s) => s.done).length
  const next = list.find((s) => !s.done && !s.locked)
  const allDone = steps !== null && count === list.length

  // The empty Risk Dashboard (UC-7.3, 2a) offers the next action this member can take.
  const nextAction =
    next?.key === "target" && canRegister ? (
      <Button asChild variant="outline" className="h-9 gap-1.5">
        <Link href="/targets/new">
          <Plus aria-hidden="true" />
          Register target
        </Link>
      </Button>
    ) : next?.key === "verification" && canVerify && steps?.unverified_target ? (
      <Button asChild variant="outline" className="h-9 gap-1.5">
        <Link href={`/targets/${steps.unverified_target.id}`}>
          <ShieldCheck aria-hidden="true" />
          Verify ownership
        </Link>
      </Button>
    ) : next?.key === "campaign_run" && canCampaign && steps?.verified_target ? (
      <Button asChild variant="outline" className="h-9 gap-1.5">
        <Link href={`/campaigns/new?target=${steps.verified_target.id}&suite=QUICK-REGRESSION`}>
          <Rocket aria-hidden="true" />
          Launch campaign
        </Link>
      </Button>
    ) : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Sentra, {firstName(session.name)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {allDone
            ? `${organization} is set up. Its results grow with every campaign run.`
            : `Set up ${organization} and get your first results in about 15 minutes.`}
        </p>
        {allDone && (
          <Button asChild className="mt-3 h-9 hover:bg-primary-hover">
            <Link href="/dashboard">Open the Risk Dashboard</Link>
          </Button>
        )}
      </div>

      {failed && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            The first steps could not be loaded.
            <Button variant="outline" size="sm" onClick={() => setReloads((n) => n + 1)}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="setup-heading" className="rounded-[10px] border bg-card">
          <div className="space-y-3 px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <h2 id="setup-heading" className="text-[15px] font-semibold">
                Set up your workspace
              </h2>
              <span className="tabular text-sm text-muted-foreground" aria-live="polite">
                {steps ? `${count} of ${list.length} complete` : ""}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={0}
              aria-valuemax={5}
              aria-valuenow={count}
              aria-valuetext={`${count} of 5 steps complete`}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(count / 5) * 100}%` }} />
            </div>
          </div>
          {!steps && !failed ? (
            <div className="space-y-2 border-t p-5" role="status" aria-label="Loading the first steps">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <ol>
              {list.map((step, i) => (
                <StepRow key={step.key} step={step} number={i + 1} next={step === next} />
              ))}
            </ol>
          )}
        </section>

        <div className="space-y-6">
          <section aria-labelledby="how-heading" className="rounded-[10px] border bg-card p-5">
            <h2 id="how-heading" className="mb-4 text-[15px] font-semibold">
              How Sentra works
            </h2>
            <ol className="grid grid-cols-5">
              {LOOP.map(({ icon: Icon, label }, i) => (
                <li key={label} className="relative flex min-w-0 flex-col items-center gap-1.5 text-center text-xs font-medium">
                  <span className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  {label}
                  {i < LOOP.length - 1 && (
                    <ArrowRight className="absolute top-3 -right-1.5 size-3 text-muted-foreground" aria-hidden="true" />
                  )}
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="rules-heading" className="rounded-[10px] border bg-card p-5">
            <h2 id="rules-heading" className="mb-3 text-[15px] font-semibold">
              Testing rules
            </h2>
            <ul className="space-y-2.5">
              {RULES.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2.5 text-sm text-text-secondary">
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {text}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {steps && !steps.campaign_run_finished && (
        <section aria-labelledby="results-heading" className="flex flex-col items-center rounded-[10px] border bg-card px-6 py-12 text-center">
          <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted" aria-hidden="true">
            <Gauge className="size-5 text-muted-foreground" />
          </span>
          <h2 id="results-heading" className="text-[15px] font-semibold">
            No campaign results yet
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Your risk score, findings and trends appear here after your first campaign run.
          </p>
          {nextAction && <div className="mt-4">{nextAction}</div>}
        </section>
      )}

      <InviteDialog
        key={inviting ?? "closed"}
        open={inviting !== null}
        initialRole={inviting ?? ""}
        onOpenChange={(open) => !open && setInviting(null)}
        onInvited={(invitation) => {
          toast.success(`Invitation sent to ${invitation.email}`, { description: "The link works for 7 days." })
          setReloads((n) => n + 1)
        }}
      />
    </div>
  )
}
