"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { EmptyState } from "@/components/layout/empty-state"
import { ConnectionTestCard } from "@/components/targets/connection-test"
import { VerifyOwnership } from "@/components/targets/verify-ownership"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { type Target, getTarget } from "@/lib/targets"

/**
 * Screen 19 for a target that was registered earlier: the same connection and ownership cards as
 * the last step of the wizard (UC-2.2, UC-2.3). The registration wizard itself uses the cards
 * directly, so a user can also leave and come back here.
 */
export function VerifyTargetPage({ id }: { id: string }) {
  const [target, setTarget] = useState<Target | null>(null)
  const [notFound, setNotFound] = useState(false)

  usePageCrumbs([
    { label: target?.name ?? "Target", href: `/targets/${id}` },
    { label: "Test and verify" },
  ])

  const load = useCallback(() => {
    getTarget(id)
      .then(setTarget)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
      })
  }, [id])

  useEffect(load, [load])

  if (notFound) {
    return (
      <EmptyState
        title="Target not found"
        action={
          <Button asChild variant="outline" className="h-9">
            <Link href="/targets">Back to targets</Link>
          </Button>
        }
      />
    )
  }
  if (!target) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the target">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[760px] space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Test and verify</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {target.name} · <span className="font-mono text-[13px]">{target.endpoint_host}</span>
        </p>
      </div>

      <ConnectionTestCard target={target} />
      <VerifyOwnership
        target={target}
        onVerified={load}
        footer={
          <Button asChild variant="outline" className="h-9">
            <Link href={`/targets/${target.id}`}>Back to the target</Link>
          </Button>
        }
      />
    </div>
  )
}
