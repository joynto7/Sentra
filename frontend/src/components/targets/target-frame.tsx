"use client"

import { useEffect, useState } from "react"

import { usePageCrumbs } from "@/components/layout/breadcrumbs"
import { GLASS_PILL } from "@/components/sentra/glass-card"
import { TargetMark } from "@/components/sentra/target-picker"
import { EndpointChip } from "@/components/targets/endpoint-chip"
import { EnvironmentBadge, OwnershipBadge } from "@/components/targets/target-badges"
import { TargetTabs, type TargetTab } from "@/components/targets/target-tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { TYPE_LABEL, getTarget, type Target } from "@/lib/targets"

/** The target's name and tabs above a list that shows only this target, such as its findings. */
export function TargetFrame({ id, tab, label, children }: { id: string; tab: TargetTab; label: string; children: React.ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null)
  const [problem, setProblem] = useState("")

  usePageCrumbs([{ label: target?.name ?? "Target", href: `/targets/${id}` }, { label }])

  useEffect(() => {
    getTarget(id)
      .then(setTarget)
      .catch((error: Error) => setProblem(error.message))
  }, [id])

  if (problem) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{problem}</AlertDescription>
      </Alert>
    )
  }
  return (
    <>
      <div className="mb-5 min-h-[60px]">
        {target ? (
          <div className="flex items-start gap-4">
            <TargetMark name={target.name} className="size-14 text-xl" />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">{target.name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={cn("h-6 font-normal", GLASS_PILL)}>
                  {TYPE_LABEL[target.type]}
                </Badge>
                <EnvironmentBadge
                  environment={target.environment}
                  className={target.environment === "production" ? "rounded-full px-3" : GLASS_PILL}
                />
                <OwnershipBadge status={target.status} className={GLASS_PILL} />
              </div>
              <EndpointChip url={target.endpoint_url} />
            </div>
          </div>
        ) : (
          <Skeleton className="h-8 w-72" />
        )}
      </div>
      <TargetTabs targetId={id} active={tab} />
      {children}
    </>
  )
}
