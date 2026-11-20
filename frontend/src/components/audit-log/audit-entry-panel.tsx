"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, CircleAlert, CircleCheck } from "lucide-react"

import { CopyButton } from "@/components/sentra/copy-button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import {
  type AuditEntryDetail,
  type AuditScope,
  type Integrity,
  actorLabel,
  changes,
  fullTime,
  getEntry,
  itemHref,
  itemTypeLabel,
  otherDetails,
  shortHash,
} from "@/lib/audit-log"

const ACTOR_KINDS: Record<string, string> = {
  user: "Member",
  sentra: "An automatic action of Sentra",
  api_key: "An API key of the organization",
  person: "Someone without a Sentra account yet",
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 border-b py-3 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  )
}

/** Whether this entry is covered by the last full check of the chain (UC-10.3, 5a). */
function ChainStatus({ entry, integrity }: { entry: AuditEntryDetail; integrity: Integrity | null | undefined }) {
  if (!entry.hash_matches) {
    return (
      <p className="flex items-start gap-2 text-sm font-medium text-destructive">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        The entry&apos;s content doesn&apos;t match its hash: it was changed outside Sentra.
      </p>
    )
  }
  if (integrity && !integrity.verified && integrity.broken_seq !== null && entry.seq >= integrity.broken_seq) {
    return (
      <p className="flex items-start gap-2 text-sm font-medium text-destructive">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Not verifiable: the hash chain is broken from entry {integrity.broken_seq.toLocaleString("en-GB")} on.
      </p>
    )
  }
  return (
    <p className="flex items-start gap-2 text-sm font-medium text-success">
      <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {integrity?.verified
        ? "Its content matches its hash, and it is linked to the previous entry in the verified hash chain."
        : "Its content matches its hash."}
    </p>
  )
}

/** Screen 58, side panel: one entry with its details and its place in the hash chain (UC-10.3
 * step 3, NFR-8.3). */
export function AuditEntryPanel({
  scope,
  entryId,
  integrity,
  onClose,
}: {
  scope: AuditScope
  entryId: string | null
  integrity: Integrity | null | undefined
  onClose: () => void
}) {
  // Kept with the entry it belongs to, so opening another entry never shows the previous one.
  const [loaded, setLoaded] = useState<{ id: string; entry: AuditEntryDetail | null; error: string | null } | null>(null)

  useEffect(() => {
    if (!entryId) return
    let active = true
    getEntry(scope, entryId)
      .then((found) => active && setLoaded({ id: entryId, entry: found, error: null }))
      .catch(
        (err) =>
          active &&
          setLoaded({ id: entryId, entry: null, error: err instanceof ApiError ? err.message : "The entry could not be loaded. Try again." }),
      )
    return () => {
      active = false
    }
  }, [scope, entryId])

  const entry = loaded?.id === entryId ? loaded.entry : null
  const error = loaded?.id === entryId ? loaded.error : null

  const change = entry ? changes(entry.details) : []
  const details = entry ? otherDetails(entry.details) : []
  const href = entry?.item ? itemHref(scope, entry.item) : null

  return (
    <Sheet open={!!entryId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]">
        <SheetHeader className="border-b px-6 py-4 pr-12">
          <SheetTitle className="text-base font-semibold">Audit entry</SheetTitle>
          <SheetDescription className="sr-only">
            Who did what, when and from where, and the entry&apos;s place in the hash chain.
          </SheetDescription>
        </SheetHeader>

        {error && (
          <p role="alert" className="px-6 py-5 text-sm text-destructive">
            {error}
          </p>
        )}
        {!entry && !error && (
          <div className="space-y-3 px-6 py-5" role="status" aria-label="Loading the entry">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {entry && (
          <div className="space-y-6 px-6 py-5">
            <div>
              <p className="text-[15px] leading-snug font-medium">{entry.summary}</p>
              <code className="mt-2 inline-block rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{entry.action}</code>
            </div>

            {change.length > 0 && (
              <section aria-labelledby="entry-change">
                <h3 id="entry-change" className="mb-2 text-sm font-semibold">
                  Change
                </h3>
                <ul className="space-y-2">
                  {change.map((c) => (
                    <li key={c.field} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <div className="rounded-lg border bg-muted px-3 py-2">
                        <div className="text-xs text-muted-foreground">Before · {c.field.toLowerCase()}</div>
                        <div className="text-sm font-medium">{c.before}</div>
                      </div>
                      <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                      <span className="sr-only">changed to</span>
                      <div className="rounded-lg border px-3 py-2">
                        <div className="text-xs text-muted-foreground">After · {c.field.toLowerCase()}</div>
                        <div className="text-sm font-medium">{c.after}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <dl>
              <Row label="Time">
                <span className="tabular">{fullTime(entry.occurred_at)}</span>
              </Row>
              <Row label="User">
                {actorLabel(entry.actor)}
                <div className="text-xs text-muted-foreground">{ACTOR_KINDS[entry.actor.type] ?? entry.actor.type}</div>
              </Row>
              <Row label="Affected item">
                {entry.item ? (
                  <>
                    {href ? (
                      <Link href={href} className="inline-flex min-h-6 items-center font-medium text-link hover:underline">
                        {entry.item.label}
                      </Link>
                    ) : (
                      entry.item.label
                    )}
                    <div className="text-xs text-muted-foreground">{itemTypeLabel(entry.item.type)}</div>
                  </>
                ) : (
                  "None"
                )}
              </Row>
              <Row label="IP address">
                {entry.source_address ? (
                  <span className="font-mono">{entry.source_address}</span>
                ) : entry.actor.type === "sentra" ? (
                  "Sentra (internal)"
                ) : (
                  "Not recorded"
                )}
              </Row>
              {details.map((d) => (
                <Row key={d.label} label={d.label}>
                  {d.value}
                </Row>
              ))}
              <Row label="Entry">
                <span className="tabular">No. {entry.seq.toLocaleString("en-GB")} in the chain</span>
                <div className="font-mono text-xs text-muted-foreground">{entry.id}</div>
              </Row>
            </dl>

            <section aria-labelledby="entry-integrity">
              <h3 id="entry-integrity" className="mb-2 text-sm font-semibold">
                Integrity
              </h3>
              <div className="divide-y rounded-lg border">
                {[
                  { label: "Entry hash", value: entry.entry_hash },
                  { label: "Previous hash", value: entry.prev_hash },
                ].map((hash) => (
                  <div key={hash.label} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                    <span className="w-28 text-sm text-muted-foreground">{hash.label}</span>
                    <span className="min-w-0 flex-1 font-mono text-xs break-all" title={hash.value}>
                      {shortHash(hash.value)}
                    </span>
                    <CopyButton text={hash.value} description={`Copy the full ${hash.label.toLowerCase()}`} />
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <ChainStatus entry={entry} integrity={integrity} />
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
