"use client"

import { useState } from "react"
import { Check, Copy, Download, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { StatusChip, TypeMark, formatBytes, scopeText } from "@/components/reports/report-parts"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { type Report, TYPE_DESCRIPTION, TYPE_LABEL, downloadUrl } from "@/lib/reports"
import { formatDate, formatDateTime } from "@/lib/targets"

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 border-b py-2.5 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/** Everything the list does not show of one report: its size, what it found, the checksum to copy. */
export function ReportDetails({
  report,
  canReuse,
  busy,
  onClose,
  onReuse,
}: {
  report: Report | null
  canReuse: boolean
  busy: boolean
  onClose: () => void
  onReuse: (report: Report) => void
}) {
  const [copied, setCopied] = useState(false)

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success("The checksum is copied.")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("It could not be copied. Select it and copy it by hand.")
    }
  }

  return (
    <Sheet open={report !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-[460px]">
        {report && (
          <>
            <SheetHeader className="border-b pb-4">
              <div className="flex items-center gap-3 pr-8">
                <TypeMark type={report.type} />
                <div className="min-w-0">
                  <SheetTitle className="text-lg">{report.code}</SheetTitle>
                  <SheetDescription>{TYPE_LABEL[report.type]} report</SheetDescription>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <StatusChip report={report} />
                <span className="text-xs text-muted-foreground">{TYPE_DESCRIPTION[report.type]}</span>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 py-2">
              <dl>
                <Row label="Covers">{scopeText(report)}</Row>
                <Row label="Period">
                  {report.period_from && report.period_to
                    ? `${formatDate(report.period_from)} – ${formatDate(report.period_to)}`
                    : "The state at the time it was made"}
                </Row>
                <Row label="Format">{report.format.toUpperCase()}</Row>
                <Row label="Size">{formatBytes(report.size_bytes)}</Row>
                <Row label="Made">{formatDateTime(report.created_at)}</Row>
                <Row label="Requested by">
                  {report.requested_by ?? "Sentra"}
                  {report.schedule && <span className="block text-xs text-muted-foreground">by the schedule “{report.schedule}”</span>}
                </Row>
                {typeof report.summary.findings === "number" && (
                  <Row label="Findings">
                    {report.summary.findings}
                    {typeof report.summary.unconfirmed === "number" && report.summary.unconfirmed > 0 && (
                      <span className="block text-xs text-muted-foreground">{report.summary.unconfirmed} still wait for confirmation</span>
                    )}
                  </Row>
                )}
                {report.message && <Row label="Note">{report.message}</Row>}
                {report.checksum && (
                  <Row label="SHA-256">
                    <span className="block font-mono text-xs break-all">{report.checksum}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 h-8 gap-1.5"
                      onClick={() => void copy(report.checksum as string)}
                    >
                      {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                      {copied ? "Copied" : "Copy checksum"}
                    </Button>
                  </Row>
                )}
              </dl>
            </div>

            <SheetFooter className="flex-row gap-2 border-t pt-4">
              {report.status === "ready" && report.checksum && (
                <Button asChild className="h-9 flex-1">
                  <a href={downloadUrl(report.code)} download>
                    <Download aria-hidden="true" />
                    Download
                  </a>
                </Button>
              )}
              {canReuse && report.scope !== "campaign_run" && report.status !== "generating" && (
                <Button
                  variant="outline"
                  className="h-9 flex-1"
                  disabled={busy}
                  onClick={() => {
                    onClose()
                    onReuse(report)
                  }}
                >
                  <RotateCcw aria-hidden="true" />
                  {report.status === "failed" ? "Try again" : "Use again"}
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
