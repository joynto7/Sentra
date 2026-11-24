"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { FilePen } from "lucide-react"

import { type DraftSummary, draftEntryStatus } from "@/components/campaigns/draft-entry"
import { clearDraft, draftKey, loadDraft } from "@/components/campaigns/builder/setup"
import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api"
import { useCan } from "@/lib/permissions"
import { type Target, getTarget } from "@/lib/targets"

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

/**
 * The unfinished campaign kept on this device (one per person and organization), as an entry point
 * on the Campaigns page: which target and how many suites, when it was kept, whether its target is
 * still there and verified, and the way back into the builder, which rechecks every choice. It is
 * device-local, as the draft itself is: the card says so. Nothing is started, submitted or approved
 * from here, and a draft whose target is gone or not verified opens at the target step, never with a
 * substitute.
 */
export function CampaignDraftEntry() {
  const session = useSession()
  const canCreate = useCan("manage_campaigns")
  const key = draftKey(session.id, session.organization?.id ?? "")
  const [draft, setDraft] = useState<DraftSummary | null>(null)
  const [target, setTarget] = useState<Target | null | undefined>(undefined)
  const [couldNotCheck, setCouldNotCheck] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // Read after the page has mounted, because the draft lives in this browser only
  useEffect(() => {
    const timer = setTimeout(() => {
      const kept = loadDraft(key)
      setDraft(kept ? { targetId: kept.data.setup.targetId, suites: kept.data.setup.chosen.length, step: kept.data.step, savedAt: kept.savedAt } : null)
    }, 0)
    return () => clearTimeout(timer)
  }, [key])

  const targetId = draft?.targetId
  useEffect(() => {
    if (!targetId) return
    let alive = true
    getTarget(targetId)
      .then((found) => alive && (setTarget(found), setCouldNotCheck(false)))
      .catch((error) => {
        if (!alive) return
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) setTarget(null)
        else setCouldNotCheck(true)
      })
    return () => {
      alive = false
    }
  }, [targetId])

  if (!draft) return null
  const status = couldNotCheck ? { state: "ok" as const, message: "Its target could not be checked just now. It is checked again when the draft opens.", canContinue: canCreate !== false } : draftEntryStatus(draft, target, canCreate !== false)

  return (
    <section aria-label="Unfinished campaign" className="mb-5 rounded-[10px] border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FilePen className="size-4 text-muted-foreground" aria-hidden="true" />
            You have an unfinished campaign
          </h2>
          <p className="mt-1 text-[13px] text-text-secondary">
            {target ? target.name : draft.targetId ? "A target" : "No target yet"} · {draft.suites} {draft.suites === 1 ? "suite" : "suites"} · step {draft.step + 1} · kept on this device{" "}
            {WHEN.format(new Date(draft.savedAt))}. It is not shared with anyone and not saved on the server.
          </p>
          <p role="status" className="mt-1 text-[13px] text-muted-foreground">
            {status ? status.message : "Checking its target…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status?.canContinue && (
            <Button asChild className="h-9 hover:bg-primary-hover">
              <Link href="/campaigns/new">Continue</Link>
            </Button>
          )}
          {!confirming ? (
            <Button type="button" variant="outline" className="h-9" onClick={() => setConfirming(true)}>
              Discard
            </Button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-[13px]" role="group" aria-label="Discard the draft?">
              Discard it? It can&apos;t be brought back.
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-8"
                onClick={() => {
                  clearDraft(key)
                  setDraft(null)
                  setConfirming(false)
                  // The card is gone: the keyboard goes to the next useful control, not to the top of the page
                  setTimeout(() => document.querySelector<HTMLElement>('a[href="/campaigns/new"]')?.focus(), 0)
                }}
              >
                Discard
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
