"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { type VersionComparison, longDate } from "@/lib/threat-models"

const FIELD: Record<string, string> = {
  title: "Title",
  owasp: "OWASP",
  atlas: "MITRE ATLAS",
  likelihood: "Likelihood",
  impact: "Impact",
}

/** UC-3.2, 5b: someone saved a newer version during the review. Their changes are shown before
 * the user saves or approves. */
export function NewerVersionDialog({
  comparison,
  onKeep,
  onDiscard,
}: {
  comparison: VersionComparison | null
  onKeep: () => void
  onDiscard: () => void
}) {
  if (!comparison) return null
  const { base, compare, added, removed, changed } = comparison
  const who = compare.created_by ?? "Sentra"
  return (
    <Dialog open onOpenChange={(open) => !open && onKeep()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Version {compare.version} was saved while you were reviewing</DialogTitle>
          <DialogDescription>
            {who} saved version {compare.version} on {longDate(compare.created_at)}, after version {base.version} that
            you were reviewing. Check their changes, then save or approve again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {comparison.identical && <p>The threats are the same as in version {base.version}.</p>}
          {added.length > 0 && (
            <section aria-labelledby="newer-added">
              <h3 id="newer-added" className="font-medium">
                Added
              </h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {added.map((t) => (
                  <li key={t.number}>
                    {t.title}
                    {t.reason && <span className="text-muted-foreground"> — {t.reason}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {removed.length > 0 && (
            <section aria-labelledby="newer-removed">
              <h3 id="newer-removed" className="font-medium">
                Removed
              </h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {removed.map((t) => (
                  <li key={t.number}>
                    {t.title}
                    {t.reason && <span className="text-muted-foreground"> — {t.reason}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {changed.length > 0 && (
            <section aria-labelledby="newer-changed">
              <h3 id="newer-changed" className="font-medium">
                Changed
              </h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {changed.map((t) => (
                  <li key={t.number}>
                    {t.title}:{" "}
                    {t.changes.map((c) => `${FIELD[c.field] ?? c.field} ${c.before} → ${c.after}`).join("; ")}
                    {t.reason && <span className="text-muted-foreground"> — {t.reason}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onDiscard}>
            Discard my changes
          </Button>
          <Button className="hover:bg-primary-hover" onClick={onKeep}>
            Keep my changes on v{compare.version}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
