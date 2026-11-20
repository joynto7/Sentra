"use client"

import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { type KnownVulnerability, type LabCard, knownVulnerabilities } from "@/lib/lab"

/**
 * What a lab target is documented to be vulnerable to (FR-11.1, UC-11.1 step 1). The list comes
 * from the application itself, so it can never be a copy that has drifted.
 */
export function KnownVulnerabilitiesDialog({
  card,
  onClose,
}: {
  card: LabCard | null
  onClose: () => void
}) {
  const [found, setFound] = useState<KnownVulnerability[] | null>(null)
  const [failed, setFailed] = useState(false)
  const targetId = card?.target_id ?? null

  useEffect(() => {
    if (!targetId) return
    let current = true
    knownVulnerabilities(targetId)
      .then((list) => current && setFound(list))
      .catch(() => current && setFailed(true))
    return () => {
      current = false
    }
  }, [targetId])

  return (
    <Dialog open={!!card} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Known vulnerabilities of {card?.name}</DialogTitle>
          <DialogDescription>
            What this lab target is built to be weak at, as the application itself documents it. A
            campaign that finds them is working.
          </DialogDescription>
        </DialogHeader>
        {!found && !failed && (
          <div className="space-y-2" role="status" aria-label="Loading the known vulnerabilities">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {failed && <p className="text-sm text-destructive">The list could not be loaded.</p>}
        {found && (
          <ul className="space-y-3">
            {found.map((item) => (
              <li key={item.id} className="rounded-[10px] border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">{item.title}</h3>
                  <Badge variant="outline" className="font-mono text-xs">
                    {item.category}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{item.id}</p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
