"use client"

import { useState } from "react"
import { CircleAlert, Download, Info, Lock } from "lucide-react"

import { SegmentedControl } from "@/components/sentra/segmented-control"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ApiError } from "@/lib/api"
import { type AuditQuery, type AuditScope, type Integrity, exportEntries } from "@/lib/audit-log"

const FORMATS = [
  { value: "csv" as const, label: "CSV" },
  { value: "json" as const, label: "JSON" },
]

/** Screen 58, export dialog: UC-10.3 steps 4-6. The hashes are always included, so an external
 * auditor can check the export against the hash chain; the export is itself recorded. */
export function ExportDialog({
  open,
  scope,
  query,
  scopeText,
  integrity,
  onOpenChange,
  onExported,
}: {
  open: boolean
  scope: AuditScope
  query: AuditQuery
  /** "1,286 entries · last 7 days · all users, actions and items" */
  scopeText: string
  integrity: Integrity | null | undefined
  onOpenChange: (open: boolean) => void
  onExported: (file: string, format: "csv" | "json") => void
}) {
  const [format, setFormat] = useState<"csv" | "json">("csv")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const broken = integrity && !integrity.verified

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const file = await exportEntries(scope, query, format)
      onExported(file, format)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The export could not be made. Try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Export audit log</DialogTitle>
          <DialogDescription>{scopeText}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <span id="export-format" className="text-sm font-medium">
              Format
            </span>
            <SegmentedControl labelledBy="export-format" value={format} options={FORMATS} onChange={setFormat} />
          </div>
          <div className="flex items-start gap-3">
            <Checkbox id="export-hashes" checked disabled aria-describedby="export-hashes-note" className="mt-0.5" />
            <div>
              <label htmlFor="export-hashes" className="flex items-center gap-1.5 text-sm font-medium">
                Include hashes for external verification
                <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </label>
              <p id="export-hashes-note" className="text-sm text-muted-foreground">
                Always included, so the export can be checked against the hash chain.
              </p>
            </div>
          </div>
          {broken && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              The hash chain is broken from entry {integrity.broken_seq?.toLocaleString("en-GB")} on. The export marks
              those entries as not verifiable.
            </p>
          )}
          <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
            <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            The export is recorded in the audit log.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" className="h-9">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" className="h-9 gap-1.5 hover:bg-primary-hover" onClick={submit} disabled={pending}>
            <Download aria-hidden="true" />
            {pending ? "Exporting…" : `Export ${format.toUpperCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
