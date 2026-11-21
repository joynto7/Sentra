"use client"

import { useEffect, useState } from "react"
import { Check, Download, Fingerprint, Info } from "lucide-react"

import { SegmentedControl } from "@/components/sentra/segmented-control"
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
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ApiError } from "@/lib/api"
import {
  EXPORT_LEVEL_ABOUT,
  EXPORT_LEVEL_LABEL,
  type ExportFormat,
  type ExportLevel,
  type ExportSummary,
  exportBenchmark,
  exportSummary,
} from "@/lib/lab"
import { cn } from "@/lib/utils"

const FORMATS = [
  { value: "csv" as const, label: "CSV" },
  { value: "json" as const, label: "JSON" },
]
const LEVELS: ExportLevel[] = ["strategy", "repetition", "attempt"]

/**
 * Screen 69, the export dialog (FR-11.5, UC-11.6): the format, the level of detail, and what
 * goes with the results whether or not anyone asks for it — the configuration, the versions and
 * the analyst's labels, because an experiment that can't be repeated isn't a result.
 */
export function BenchmarkExportDialog({
  code,
  summary: about,
  open,
  onOpenChange,
}: {
  code: string
  /** "1 lab target · 2 strategies · 3 completed repetitions per strategy" */
  summary: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [format, setFormat] = useState<ExportFormat>("csv")
  const [level, setLevel] = useState<ExportLevel>("repetition")
  const [rows, setRows] = useState<ExportSummary | null>(null)
  const [made, setMade] = useState<{ name: string; checksum: string | null } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    exportSummary(code, controller.signal)
      .then(setRows)
      .catch(() => undefined)
    return () => controller.abort()
  }, [code, open])

  async function create() {
    setPending(true)
    setError(null)
    try {
      const file = await exportBenchmark(code, format, level)
      setMade({ name: file.name, checksum: file.checksum })
    } catch (failed) {
      setError(
        failed instanceof ApiError ? failed.message : "The export could not be made. Try again.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null)
          setMade(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Export results of {code}</DialogTitle>
          <DialogDescription>{about}</DialogDescription>
        </DialogHeader>

        {made ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-[8px] bg-muted p-3 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span>
                <span className="font-medium">{made.name}</span> was saved by your browser.
              </span>
            </p>
            {made.checksum && (
              <div>
                <h3 className="flex items-center gap-1.5 text-sm font-medium">
                  <Fingerprint className="size-4 text-muted-foreground" aria-hidden="true" />
                  SHA-256 of the file
                </h3>
                <p className="mt-1 rounded-[8px] border p-3 font-mono text-xs break-all">
                  {made.checksum}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Anyone with the file can check it:{" "}
                  <code className="font-mono">sha256sum {made.name}</code>
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <span id="export-format" className="text-sm font-medium">
                Format
              </span>
              <SegmentedControl
                labelledBy="export-format"
                value={format}
                options={FORMATS}
                onChange={setFormat}
              />
              <p className="text-xs text-muted-foreground">
                {format === "csv"
                  ? "One table, with the configuration and the versions as comment lines above it."
                  : "One document: the configuration, the versions, the labels and the results."}
              </p>
            </div>

            <div className="space-y-2">
              <span id="export-level" className="text-sm font-medium">
                Level of detail
              </span>
              <RadioGroup
                aria-labelledby="export-level"
                value={level}
                onValueChange={(next) => setLevel(next as ExportLevel)}
                className="gap-2"
              >
                {LEVELS.map((one) => (
                  <Label
                    key={one}
                    htmlFor={`level-${one}`}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-[8px] border p-3 font-normal",
                      level === one && "border-primary bg-muted/40",
                    )}
                  >
                    <RadioGroupItem id={`level-${one}`} value={one} className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">
                        {EXPORT_LEVEL_LABEL[one]}
                        {rows && (
                          <span className="tabular ml-1.5 font-normal text-muted-foreground">
                            {rows[one].toLocaleString("en-GB")} row
                            {rows[one] === 1 ? "" : "s"}
                          </span>
                        )}
                      </span>
                      <span className="block text-[13px] text-muted-foreground">
                        {EXPORT_LEVEL_ABOUT[one]}
                      </span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            <div>
              <h3 className="text-sm font-medium">Included automatically</h3>
              <ul className="mt-2 space-y-1.5 rounded-[8px] bg-muted/50 p-3 text-sm">
                {[
                  `Configuration of ${code}`,
                  "Versions of tests, suites, lab targets, known-vulnerability lists and models",
                  `The analyst's labels${rows ? ` (${rows.labels})` : ""}`,
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>

            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Fingerprint className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              A SHA-256 checksum is shown after the export is created, so the file can be verified.
            </p>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              The export is recorded in the audit log.
            </p>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" className="h-9">
              {made ? "Done" : "Cancel"}
            </Button>
          </DialogClose>
          {!made && (
            <Button type="button" className="h-9 gap-1.5" onClick={() => void create()} disabled={pending}>
              <Download aria-hidden="true" />
              {pending ? "Creating…" : "Create export"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
