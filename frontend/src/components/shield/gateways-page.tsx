"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ShieldOff, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/layout/empty-state"
import { PageHeader } from "@/components/layout/page-header"
import { GatewayCard, WHAT_TO_DO, WaitingCard } from "@/components/shield/gateway-card"
import { ShieldMotion, ShieldStory } from "@/components/shield/shield-story"
import { ViewSwitch, useStoredView } from "@/components/sentra/view-switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import { type Gateway, type GatewayList, STATUS_IS_A_PROBLEM, type TargetRef, listGateways, revokeGateway, sinceNow } from "@/lib/shield"
import { formatDate } from "@/lib/targets"
import { cn } from "@/lib/utils"

function StatusCell({ gateway }: { gateway: Gateway }) {
  const problem = STATUS_IS_A_PROBLEM[gateway.status]
  return (
    <span className="block">
      <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", problem ? "text-warning" : "text-text-secondary")}>
        {problem && <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />}
        {gateway.status_label}
      </span>
      {WHAT_TO_DO[gateway.status] && <span className="mt-0.5 block text-xs text-muted-foreground">{WHAT_TO_DO[gateway.status]}</span>}
    </span>
  )
}

/** The targets that could have a gateway, when the page's own button is pressed. */
function ConnectDialog({ targets, open, onClose }: { targets: TargetRef[]; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Sentra Shield</DialogTitle>
          <DialogDescription>Choose a target.</DialogDescription>
        </DialogHeader>
        <ul className="mt-2 space-y-2">
          {targets.map((target) => (
            <li key={target.id}>
              <Button asChild variant="outline" className="h-10 w-full justify-start text-[13px] font-medium">
                <Link href={`/shield/connect/${target.id}`}>{target.name}</Link>
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Screen 47 (UC-8.1, UC-8.4, UC-8.8, UC-10.9): every target of the organization with the Sentra
 * Shield gateway in front of it — what it is enforcing, what it adds to a request (NFR-1.5) and
 * what to do about the ones that are not protecting anything.
 */
export function GatewaysPage() {
  const canManage = useCan("manage_shield")
  const canRegister = useCan("manage_targets")
  const [data, setData] = useState<GatewayList | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useStoredView("shield")
  const [show, setShow] = useState<"all" | "protected" | "attention" | "none">("all")

  useEffect(() => {
    const controller = new AbortController()
    listGateways(controller.signal)
      .then((found) => {
        setData(found)
        setError(false)
      })
      .catch(() => !controller.signal.aborted && setError(true))
    return () => controller.abort()
  }, [attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  async function revoke(gateway: Gateway) {
    setBusy(true)
    try {
      await revokeGateway(gateway.target_id)
      toast.success(`The gateway of ${gateway.target_name} is revoked.`, {
        description: "Its credential stops working now. It keeps forwarding traffic unchanged.",
      })
      reload()
    } catch (failed) {
      toast.error(failed instanceof ApiError ? failed.message : "The gateway could not be revoked.")
    } finally {
      setBusy(false)
    }
  }

  const waiting = data?.targets_without_gateway ?? []
  // A gateway stands only in front of a verified target (UC-8.1 precondition)
  const connectable = waiting.filter((target) => target.verified !== false)
  const canVerify = useCan("verify_targets")
  const rows = data?.rows ?? []
  const protectedRows = rows.filter((row) => row.status === "active")
  const attentionRows = rows.filter((row) => row.status !== "active")
  const blocked = rows.reduce((sum, row) => sum + row.requests_blocked, 0)
  const shownRows = show === "protected" ? protectedRows : show === "attention" ? attentionRows : show === "none" ? [] : rows
  const shownWaiting = show === "all" || show === "none" ? waiting : []

  return (
    <>
      <PageHeader
        title="Sentra Shield"
        description="Gateways that enforce approved fixes."
        action={
          canManage && connectable.length > 0 ? (
            connectable.length === 1 ? (
              <Button asChild className="h-9 hover:bg-primary-hover">
                <Link href={`/shield/connect/${connectable[0].id}`}>Connect Sentra Shield</Link>
              </Button>
            ) : (
              <Button className="h-9 hover:bg-primary-hover" onClick={() => setPicking(true)}>
                Connect Sentra Shield
              </Button>
            )
          ) : undefined
        }
      />

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-center justify-between gap-4">
            The gateways could not be loaded.
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-2" role="status" aria-label="Loading the gateways">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {data && data.rows.length === 0 && waiting.length === 0 && (
        <EmptyState
          title="No target yet"
          description={canRegister ? "Register a target first." : "An AI Application Developer registers targets."}
          action={
            canRegister ? (
              <Button asChild className="h-9 hover:bg-primary-hover">
                <Link href="/targets/new">Register target</Link>
              </Button>
            ) : undefined
          }
        />
      )}

      {data && (
        <>
          <ShieldMotion />
          <ShieldStory />
          <ul className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { id: "all", label: "Targets", value: rows.length + waiting.length, note: "In all" },
              { id: "protected", label: "Protected", value: protectedRows.length, note: "Gateway reporting" },
              { id: "attention", label: "Need a look", value: attentionRows.length, note: "Not reporting or waiting" },
              { id: "none", label: "No gateway", value: waiting.length, note: `${blocked} requests blocked in all` },
            ].map((tile) => (
              <li key={tile.id}>
                <button
                  type="button"
                  aria-pressed={show === tile.id}
                  onClick={() => setShow(tile.id as typeof show)}
                  className={cn(
                    "flex h-full w-full flex-col rounded-2xl border bg-card p-4 text-left outline-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring",
                    show === tile.id ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "hover:border-border-strong",
                  )}
                >
                  <span className="text-xs text-muted-foreground">{tile.label}</span>
                  <span className="tabular mt-1 text-3xl leading-none font-semibold">{tile.value}</span>
                  <span className="mt-2 text-xs text-muted-foreground">{tile.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && (data.rows.length > 0 || waiting.length > 0) && (
        <section aria-labelledby="gateways" className="min-w-0 rounded-[10px] border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <h2 id="gateways" className="text-[15px] font-semibold">
              Gateways
              <span className="tabular ml-2 text-[13px] font-normal text-muted-foreground">
                {shownRows.length + shownWaiting.length} of {rows.length + waiting.length}
              </span>
            </h2>
            <ViewSwitch value={view} onChange={setView} />
          </div>
          {view === "cards" ? (
            <ul className="grid gap-4 bg-muted/40 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {shownRows.map((gateway) => (
                <li key={gateway.id} className="min-w-0">
                  <GatewayCard gateway={gateway} canManage={canManage} busy={busy} onRevoke={() => void revoke(gateway)} />
                </li>
              ))}
              {shownWaiting.map((target) => (
                <li key={target.id} className="min-w-0">
                  <WaitingCard
                    name={target.name}
                    id={target.id}
                    verified={target.verified !== false}
                    canManage={canManage}
                    canVerify={canVerify}
                  />
                </li>
              ))}
              {shownRows.length + shownWaiting.length === 0 && (
                <li className="col-span-full rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Nothing in this group.
                </li>
              )}
            </ul>
          ) : (
            <Table
              container={{
                tabIndex: 0,
                role: "group",
                "aria-label": "Sentra Shield gateways",
                className: "rounded-[7px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              }}
            >
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead scope="col" className="text-xs">
                    Target
                  </TableHead>
                  <TableHead scope="col" className="text-xs">
                    Position
                  </TableHead>
                  <TableHead scope="col" className="text-xs whitespace-normal">
                    Gateway version
                  </TableHead>
                  <TableHead scope="col" className="text-xs">
                    Status
                  </TableHead>
                  <TableHead scope="col" className="text-xs">
                    Last contact
                  </TableHead>
                  <TableHead scope="col" className="text-xs whitespace-normal">
                    Active Shield Policy
                  </TableHead>
                  <TableHead scope="col" className="text-xs whitespace-normal">
                    Added latency (median)
                  </TableHead>
                  <TableHead scope="col" className="text-xs">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownRows.map((gateway) => (
                  <TableRow key={gateway.id}>
                    <TableCell className="max-w-[14rem] whitespace-normal">
                      <Link
                        href={`/targets/${gateway.target_id}/shield`}
                        className="inline-flex min-h-6 items-center text-[13px] font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {gateway.target_name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {gateway.target_environment === "production" ? "Production" : "Staging"}
                        {gateway.target_archived && " · Target archived: revoke the gateway when it is gone"}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[12rem] text-[13px] whitespace-normal">{gateway.position_label}</TableCell>
                    <TableCell className="font-mono text-[13px]">{gateway.gateway_version ?? "—"}</TableCell>
                    <TableCell>
                      <StatusCell gateway={gateway} />
                    </TableCell>
                    <TableCell className="text-[13px]">{sinceNow(gateway.last_contact_at)}</TableCell>
                    <TableCell className="text-[13px]">
                      {gateway.active_policy_version ? (
                        <>
                          <Link
                            href={`/targets/${gateway.target_id}/shield`}
                            className="inline-flex min-h-6 min-w-6 items-center justify-center font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            v{gateway.active_policy_version}
                          </Link>
                          {gateway.active_policy_since && (
                            <span className="block text-xs text-muted-foreground">since {formatDate(gateway.active_policy_since)}</span>
                          )}
                          {gateway.policy_version !== gateway.active_policy_version && (
                            <span className="block text-xs text-warning">the gateway reports v{gateway.policy_version}</span>
                          )}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <ShieldOff className="size-3.5" aria-hidden="true" />
                          No policy
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {gateway.added_latency_ms === null ? "—" : `${gateway.added_latency_ms} ms`}
                    </TableCell>
                    <TableCell className="space-x-2 text-right whitespace-nowrap">
                      {/* An archived target gets no new gateway, so there is nothing to troubleshoot */}
                      {STATUS_IS_A_PROBLEM[gateway.status] && gateway.status !== "revoked" && !gateway.target_archived && (
                        <Button asChild variant="outline" size="sm" className="h-8">
                          <Link href={`/shield/connect/${gateway.target_id}?step=3`}>Troubleshoot</Link>
                        </Button>
                      )}
                      {canManage && gateway.status !== "revoked" && (
                        <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => revoke(gateway)}>
                          Revoke
                        </Button>
                      )}
                      {canManage && gateway.status === "revoked" && (
                        <Button asChild variant="outline" size="sm" className="h-8">
                          <Link href={`/shield/connect/${gateway.target_id}`}>Connect again</Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {shownWaiting.map((target) => (
                  <TableRow key={target.id}>
                    <TableCell className="max-w-[14rem] whitespace-normal">
                      <Link
                        href={`/targets/${target.id}`}
                        className="inline-flex min-h-6 items-center text-[13px] font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {target.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-[13px]">—</TableCell>
                    <TableCell className="text-[13px]">—</TableCell>
                    <TableCell className="text-[13px] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 font-medium text-warning">
                        <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                        No gateway
                      </span>
                    </TableCell>
                    <TableCell className="text-[13px]">—</TableCell>
                    <TableCell className="text-[13px]">—</TableCell>
                    <TableCell className="text-[13px]">—</TableCell>
                    <TableCell className="text-right">
                      {target.verified === false ? (
                        canVerify ? (
                          <Link
                            href={`/targets/${target.id}/verify`}
                            className="inline-block max-w-32 py-0.5 text-[13px] whitespace-normal text-link underline underline-offset-2"
                          >
                            Verify ownership first
                          </Link>
                        ) : (
                          <span className="inline-block max-w-32 text-[13px] whitespace-normal text-muted-foreground">
                            Ownership not verified yet
                          </span>
                        )
                      ) : (
                        canManage && (
                          <Button asChild variant="outline" size="sm" className="h-8">
                            <Link href={`/shield/connect/${target.id}`}>Connect</Link>
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      <ConnectDialog targets={connectable} open={picking} onClose={() => setPicking(false)} />
    </>
  )
}
