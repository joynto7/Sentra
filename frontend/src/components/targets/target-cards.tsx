"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useCan } from "@/lib/permissions"
import { getCoverage, type Coverage } from "@/lib/risk"
import { listGateways, sinceNow, type Gateway } from "@/lib/shield"

/** The Sentra Shield card of Screen 20: is there a gateway, what does it enforce, does it report. */
export function TargetShieldSummary({ targetId }: { targetId: string }) {
  const canConnect = useCan("manage_shield")
  const [state, setState] = useState<{ gateway: Gateway | null } | "loading" | "failed">("loading")

  useEffect(() => {
    const controller = new AbortController()
    listGateways(controller.signal)
      .then((found) =>
        setState({ gateway: found.rows.find((row) => row.target_id === targetId) ?? null }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setState("failed")
      })
    return () => controller.abort()
  }, [targetId])

  if (state === "loading") return <Skeleton className="h-16 w-full" />
  if (state === "failed") {
    return <p className="text-sm text-muted-foreground">The gateway&apos;s state can&apos;t be shown right now.</p>
  }
  const { gateway } = state
  if (!gateway) {
    return (
      <>
        <p className="text-sm">No gateway yet, so approved fixes can&apos;t be enforced here.</p>
        {canConnect ? (
          <Button asChild variant="outline" size="sm" className="h-8 w-fit">
            <Link href={`/shield/connect/${targetId}`}>Connect Sentra Shield</Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">An AI Application Developer connects it.</p>
        )}
      </>
    )
  }
  const parts = [
    gateway.position_label,
    gateway.active_policy_version ? `Shield Policy v${gateway.active_policy_version}` : "no Shield Policy yet",
    gateway.last_contact_at ? `last contact ${sinceNow(gateway.last_contact_at)}` : "no contact yet",
    gateway.added_latency_ms !== null ? `adds ${gateway.added_latency_ms} ms (median)` : null,
  ].filter(Boolean)
  return (
    <>
      <p className="text-sm font-medium">{gateway.status_label}</p>
      <p className="text-xs text-muted-foreground">{parts.join(" · ")}</p>
      <Link href={`/targets/${targetId}/shield`} className="text-sm text-link hover:underline">
        Open Sentra Shield
      </Link>
    </>
  )
}

function spoken(codes: string[]): string {
  return codes.length > 1 ? `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}` : (codes[0] ?? "")
}

/** The Framework coverage card of Screen 20: what really ran against this target, and what didn't. */
export function TargetCoverageSummary({ targetId }: { targetId: string }) {
  const [coverage, setCoverage] = useState<Coverage | "failed" | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getCoverage(new URLSearchParams({ framework: "owasp", target_id: targetId }), controller.signal)
      .then(setCoverage)
      .catch(() => {
        if (!controller.signal.aborted) setCoverage("failed")
      })
    return () => controller.abort()
  }, [targetId])

  if (coverage === null) return <Skeleton className="h-16 w-full" />
  if (coverage === "failed") {
    return <p className="text-sm text-muted-foreground">Coverage can&apos;t be shown right now.</p>
  }
  const inScope = coverage.rows.filter((row) => row.in_scope)
  const outside = coverage.rows.filter((row) => !row.in_scope).map((row) => row.code)
  const status = (row: Coverage["rows"][number]) => row.cells[0]?.status ?? row.status
  if (inScope.some((row) => status(row) === "not_testable")) {
    return <p className="text-sm">Nothing has been tested yet, because ownership isn&apos;t verified.</p>
  }
  const applicable = inScope.filter((row) => status(row) !== "not_applicable")
  const tested = applicable.filter((row) => status(row) === "tested")
  const missing = applicable.filter((row) => status(row) !== "tested").map((row) => row.code)
  return (
    <>
      <p className="text-sm">
        {tested.length} of {applicable.length} in-scope OWASP categories tested
        {missing.length ? `; ${spoken(missing)} ${missing.length === 1 ? "is a gap" : "are gaps"}` : ""}.
      </p>
      {outside.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {spoken(outside)} {outside.length === 1 ? "is" : "are"} out of scope.
        </p>
      )}
      <Link href={`/framework-coverage?target=${targetId}`} className="text-sm text-link hover:underline">
        Open Framework Coverage
      </Link>
    </>
  )
}
