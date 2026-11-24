import Link from "next/link"
import { Cpu, MoreHorizontal, ShieldCheck, ShieldOff, TriangleAlert, User } from "lucide-react"

import { GLASS_BUTTON, GlassCard } from "@/components/sentra/glass-card"
import { TargetMark } from "@/components/sentra/target-picker"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { type Gateway, STATUS_IS_A_PROBLEM, sinceNow } from "@/lib/shield"
import { formatDate } from "@/lib/targets"
import { cn } from "@/lib/utils"

/** What a person should do about a gateway that isn't enforcing anything (UC-8.1, 5a). */
export const WHAT_TO_DO: Partial<Record<Gateway["status"], string>> = {
  pending: "The gateway hasn't connected yet.",
  not_in_path: "No traffic of the target passes through it.",
  not_reporting: "No heartbeat for three windows.",
  revoked: "Its credential no longer works.",
}

const NODE = "grid size-9 shrink-0 place-items-center rounded-full border-2 bg-white dark:bg-white/10"

/**
 * The route a request takes: users, the gateway, the app (a gateway in front of the endpoint), or
 * the app, the gateway, the model (a gateway before the provider). A live gateway has a solid blue
 * route that moves while the card is under the pointer; one that is not protecting anything has a
 * dashed grey route and a warning on its shield, so the state reads from the picture and from words.
 */
export function Route({ position, live, problem }: { position: string; live: boolean; problem: boolean }) {
  const first = position === "in_front" ? { icon: User, label: "Users" } : { icon: ShieldCheck, label: "Your app" }
  const last = position === "in_front" ? { icon: ShieldCheck, label: "Your app" } : { icon: Cpu, label: "Model" }
  const line = cn("ss-card-line h-0.5 flex-1 rounded-full", live ? "ss-live text-primary" : "text-border-strong")
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      <span className={cn(NODE, "border-[#dbe3fb] text-foreground/70 dark:border-white/15")}>
        {position === "in_front" ? <User className="size-4" /> : <AppGlyph />}
      </span>
      <span className={line} />
      <span
        className={cn(
          NODE,
          "relative",
          live
            ? "border-primary text-primary"
            : problem
              ? "border-warning text-warning"
              : "border-dashed border-border-strong text-muted-foreground",
        )}
      >
        {live ? <ShieldCheck className="size-4" /> : <ShieldOff className="size-4" />}
        {problem && <TriangleAlert className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-white text-warning dark:bg-[#151b30]" />}
      </span>
      <span className={line} />
      <span className={cn(NODE, "border-[#dbe3fb] text-foreground/70 dark:border-white/15")}>
        {position === "in_front" ? <AppGlyph /> : <Cpu className="size-4" />}
      </span>
      <span className="sr-only">
        {first.label} to {last.label}
      </span>
    </div>
  )
}

function AppGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="2" y="3" width="12" height="10" rx="2.5" />
      <path d="M5 7h6M5 10h4" />
    </svg>
  )
}

/** One target with a gateway, as a card: its route and state, what it enforces, and what to do about it. */
export function GatewayCard({
  gateway,
  canManage,
  busy,
  onRevoke,
}: {
  gateway: Gateway
  canManage: boolean | undefined
  busy: boolean
  onRevoke: () => void
}) {
  const problem = STATUS_IS_A_PROBLEM[gateway.status]
  const live = gateway.status === "active"
  const troubleshoot = problem && gateway.status !== "revoked" && !gateway.target_archived
  return (
    <GlassCard label={`${gateway.target_name}: ${gateway.status_label}`} className="group">
      <div className="flex items-start gap-3">
        <TargetMark name={gateway.target_name} className="size-11 text-base" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/targets/${gateway.target_id}/shield`}
            className="block min-h-6 truncate rounded-md text-lg leading-6 font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {gateway.target_name}
          </Link>
          <p className="text-sm text-foreground/65">
            <span className={gateway.target_environment === "production" ? "font-semibold text-foreground" : undefined}>
              {gateway.target_environment === "production" ? "Production" : "Staging"}
            </span>
            {gateway.target_archived && " · Target archived"}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-white/70 px-3 py-3 dark:bg-white/5">
        <Route position={gateway.position} live={live} problem={problem} />
        <p className="mt-2 text-xs text-foreground/65">{gateway.position_label}</p>
      </div>

      <p className={cn("mt-3 flex items-start gap-1.5 text-sm font-medium", problem ? "text-warning" : "text-success")}>
        {problem ? (
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        ) : (
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        )}
        <span>
          {gateway.status_label}
          {WHAT_TO_DO[gateway.status] && <span className="block text-xs font-normal text-foreground/65">{WHAT_TO_DO[gateway.status]}</span>}
        </span>
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-foreground/60">Policy</dt>
          <dd>
            {gateway.active_policy_version ? (
              <>
                <Link href={`/targets/${gateway.target_id}/shield`} className="font-medium text-link hover:underline">
                  v{gateway.active_policy_version}
                </Link>
                {gateway.active_policy_since && (
                  <span className="text-xs text-foreground/60"> · {formatDate(gateway.active_policy_since)}</span>
                )}
                {gateway.policy_version !== gateway.active_policy_version && (
                  <span className="block text-xs text-warning">the gateway reports v{gateway.policy_version}</span>
                )}
              </>
            ) : (
              <span className="text-foreground/65">No policy</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/60">Last contact</dt>
          <dd>{sinceNow(gateway.last_contact_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/60">Added latency</dt>
          <dd className="tabular">{gateway.added_latency_ms === null ? "—" : `${gateway.added_latency_ms} ms`}</dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/60">Blocked</dt>
          <dd className="tabular">{gateway.requests_blocked}</dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center gap-2 pt-4">
        {troubleshoot ? (
          <Link href={`/shield/connect/${gateway.target_id}?step=3`} className={GLASS_BUTTON}>
            Troubleshoot
          </Link>
        ) : canManage && gateway.status === "revoked" ? (
          <Link href={`/shield/connect/${gateway.target_id}`} className={GLASS_BUTTON}>
            Connect again
          </Link>
        ) : (
          <Link href={`/targets/${gateway.target_id}/shield`} className={GLASS_BUTTON}>
            Open policy
          </Link>
        )}
        {canManage && gateway.status !== "revoked" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="grid size-10 shrink-0 place-items-center rounded-full bg-white p-0 shadow-[0_8px_20px_-10px_rgba(15,30,70,0.5)] hover:bg-white/80 dark:bg-white/15"
                aria-label={`More for ${gateway.target_name}`}
              >
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" disabled={busy} onSelect={onRevoke}>
                Revoke the gateway
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </GlassCard>
  )
}

/** A target that has no gateway yet: the same route, dashed, and the one step that starts it. */
export function WaitingCard({
  name,
  id,
  verified,
  canManage,
  canVerify,
}: {
  name: string
  id: string
  verified: boolean
  canManage: boolean | undefined
  canVerify: boolean | undefined
}) {
  return (
    <GlassCard label={`${name}: no gateway`} className="group">
      <div className="flex items-start gap-3">
        <TargetMark name={name} className="size-11 text-base" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/targets/${id}`}
            className="block min-h-6 truncate rounded-md text-lg leading-6 font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {name}
          </Link>
          <p className="text-sm text-foreground/65">No gateway yet</p>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-dashed border-[#dbe3fb] bg-white/50 px-3 py-3 dark:border-white/15 dark:bg-white/5">
        <Route position="in_front" live={false} problem={false} />
        <p className="mt-2 text-xs text-foreground/65">Nothing stands between the users and this application.</p>
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-sm font-medium text-warning">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        No gateway
      </p>
      <div className="mt-auto flex items-center gap-2 pt-4">
        {!verified ? (
          canVerify ? (
            <Link href={`/targets/${id}/verify`} className={GLASS_BUTTON}>
              Verify ownership first
            </Link>
          ) : (
            <span className="flex h-10 flex-1 items-center justify-center rounded-full border-2 border-dashed border-[#dbe3fb] px-3 text-center text-xs text-foreground/60 dark:border-white/15">
              Ownership not verified yet
            </span>
          )
        ) : canManage ? (
          <Link href={`/shield/connect/${id}`} className={GLASS_BUTTON}>
            Connect Sentra Shield
          </Link>
        ) : (
          <span className="flex h-10 flex-1 items-center justify-center rounded-full border-2 border-dashed border-[#dbe3fb] px-3 text-center text-xs text-foreground/60 dark:border-white/15">
            A developer connects it
          </span>
        )}
      </div>
    </GlassCard>
  )
}
