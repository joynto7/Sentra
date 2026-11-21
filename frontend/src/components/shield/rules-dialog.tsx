"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { PolicyVersion } from "@/lib/shield"

/**
 * The rules of one policy version, as a person reads them (Screen 49, "View rules"). Every rule
 * names the fix and the finding it came from, so a reader can follow it back to the proposal
 * somebody approved.
 */
export function RulesDialog({
  version,
  open,
  onClose,
}: {
  version: PolicyVersion | null
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Shield Policy v{version?.version} — rules</DialogTitle>
          <DialogDescription>
            {version?.rule_count} {version?.rule_count === 1 ? "rule" : "rules"}, each one from a
            fix of a remediation somebody approved.
          </DialogDescription>
        </DialogHeader>
        <ul className="mt-2 space-y-3">
          {(version?.rules ?? []).map((rule) => (
            <li key={rule.id} className="rounded-[10px] border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-border-strong px-2 py-0.5 text-xs text-text-secondary">
                  {rule.label}
                </span>
                <span className="text-[13px] font-medium">{rule.title}</span>
              </div>
              <p className="mt-1.5 text-[13px]">{rule.says}</p>
              {rule.note && <p className="mt-1 text-xs text-muted-foreground">{rule.note}</p>}
              {rule.finding && (
                <p className="mt-1 text-xs text-muted-foreground">
                  From {rule.finding}
                  {rule.fix ? `, fix ${rule.fix}` : ""}
                </p>
              )}
            </li>
          ))}
          {version?.rules.length === 0 && (
            <li className="text-[13px] text-muted-foreground">
              This version holds no rules, so the gateway forwards all traffic unchanged.
            </li>
          )}
        </ul>
        <DialogFooter className="mt-6">
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
