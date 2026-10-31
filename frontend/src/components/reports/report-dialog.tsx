"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { toast } from "sonner"

import { SegmentedControl } from "@/components/sentra/segmented-control"
import { useSession } from "@/components/session-provider"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ApiError } from "@/lib/api"
import { listFindings } from "@/lib/findings"
import {
  FREQUENCY_LABEL,
  type Frequency,
  type Recipient,
  type Report,
  type ReportFormat,
  type ReportScope,
  type ReportType,
  type Schedule,
  type ScopeOptions,
  TYPE_DESCRIPTION,
  TYPE_LABEL,
  changeSchedule,
  createSchedule,
  generateReport,
  listReports,
  scopeOptions,
} from "@/lib/reports"
import { PERIODS } from "@/lib/risk"
import { cn } from "@/lib/utils"

/** What the dashboard hands over when the dialog is opened from it (UC-9.1, 1a1). */
export type DashboardScope = {
  target_id: string | null
  period_days: number
  category: string | null
  label: string
}

const TYPES: ReportType[] = ["executive", "technical"]
const FREQUENCIES: Frequency[] = ["after_each_run", "weekly", "monthly"]
const DEFAULT_PERIOD = "90" // the period a report covers when nobody chooses one (FR-9.1)
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Screen 53 (UC-9.1 steps 1-3 with 1a and 2a, UC-9.2 steps 1-3 and 4a): what a report covers, in
 * which format, and — with one checkbox — whether it is produced once or on a schedule. The same
 * dialog edits a schedule that exists, with its values and only what a change may touch.
 */
export function ReportDialog({
  open,
  members,
  preset,
  schedule,
  startScheduled,
  onClose,
  onDone,
}: {
  open: boolean
  /** The members who may be recipients; the dialog reads them itself when it is opened from a
   * page that doesn't have them, such as the risk dashboard. */
  members?: Recipient[]
  /** The dashboard's filters, when the dialog is opened from Screen 42. */
  preset?: DashboardScope
  /** The schedule being edited (UC-9.2, 4a); nothing when a new report is asked for. */
  schedule?: Schedule | null
  /** Opened by "Schedule report", so the schedule's own fields are there from the start. */
  startScheduled?: boolean
  onClose: () => void
  onDone: (made: Report | Schedule, scheduled: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
        {/* The fields belong to one opening: the form is mounted with it, so it starts from this
            report's or this schedule's own values and keeps nothing from the time before. */}
        {open && (
          <ReportForm
            key={schedule?.id ?? (startScheduled ? "new-schedule" : "new-report")}
            members={members}
            preset={preset}
            schedule={schedule}
            startScheduled={startScheduled}
            onClose={onClose}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReportForm({
  members,
  preset,
  schedule,
  startScheduled,
  onClose,
  onDone,
}: {
  members?: Recipient[]
  preset?: DashboardScope
  schedule?: Schedule | null
  startScheduled?: boolean
  onClose: () => void
  onDone: (made: Report | Schedule, scheduled: boolean) => void
}) {
  const organization = useSession().organization?.name ?? "this organization"
  const editing = Boolean(schedule)
  const hasMembers = Boolean(members?.length)
  const presetTarget = preset?.target_id ?? null
  const [type, setType] = useState<ReportType>(schedule?.type ?? "executive")
  const [scope, setScope] = useState<ReportScope>(schedule?.scope ?? "organization")
  const [format, setFormat] = useState<ReportFormat>(schedule?.format ?? "pdf")
  const [period, setPeriod] = useState(
    String(schedule?.period_days ?? preset?.period_days ?? DEFAULT_PERIOD),
  )
  const [targetId, setTargetId] = useState("")
  const [runId, setRunId] = useState("")
  const [usePreset, setUsePreset] = useState(Boolean(preset))
  const [scheduled, setScheduled] = useState(Boolean(schedule) || Boolean(startScheduled))
  const [name, setName] = useState(schedule?.name ?? "")
  const [frequency, setFrequency] = useState<Frequency>(schedule?.frequency ?? "monthly")
  const [recipients, setRecipients] = useState<string[]>(
    schedule?.recipients.map((one) => one.id) ?? [],
  )
  const [search, setSearch] = useState("")
  const [options, setOptions] = useState<ScopeOptions | null>(null)
  const [people, setPeople] = useState<Recipient[]>([])
  const [unconfirmed, setUnconfirmed] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>()

  useEffect(() => {
    if (editing) return
    const controller = new AbortController()
    scopeOptions(controller.signal)
      .then(setOptions)
      .catch(() => undefined)
    return () => controller.abort()
  }, [editing])

  useEffect(() => {
    if (hasMembers) return
    const controller = new AbortController()
    listReports(controller.signal)
      .then((found) => setPeople(found.members))
      .catch(() => undefined)
    return () => controller.abort()
  }, [hasMembers])

  // 2a: how many findings of this scope still require confirmation, so the sentence can say it
  // before anything is generated.
  useEffect(() => {
    if (editing) return
    const controller = new AbortController()
    const params = new URLSearchParams({
      view: "requires_confirmation",
      page_size: "1",
    })
    const target = usePreset ? presetTarget : scope === "target" ? targetId : ""
    if (target) params.set("target_id", target)
    if (scope === "campaign_run" && runId) params.set("run_id", runId)
    listFindings(params, controller.signal)
      .then((found) => setUnconfirmed(found.total))
      .catch(() => undefined)
    return () => controller.abort()
  }, [editing, scope, targetId, runId, usePreset, presetTarget])

  const request = () => {
    const fromPreset = usePreset && preset
    return {
      type,
      scope: fromPreset ? (preset.target_id ? "target" : "organization") : scope,
      format,
      target_id: fromPreset ? preset.target_id : scope === "target" ? targetId || null : null,
      campaign_run_id: scope === "campaign_run" && !fromPreset ? runId || null : null,
      period_days: type === "executive" ? Number(fromPreset ? preset.period_days : period) : null,
      category: fromPreset ? preset.category : null,
    } as const
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (scheduled && !name.trim()) return setProblem("Give the schedule a name.")
    if (scheduled && recipients.length === 0) return setProblem("Choose at least one recipient.")
    setBusy(true)
    setProblem(undefined)
    try {
      if (schedule) {
        // 4a1: the change applies from the next report; the ones it has produced stay as they are.
        const made = await changeSchedule(schedule.id, {
          name: name.trim(),
          frequency,
          recipient_ids: recipients,
        })
        toast.success("The schedule is saved.", {
          description: "The change applies from the next report.",
        })
        onDone(made, true)
        return onClose()
      }
      const data = request()
      if (data.scope === "target" && !data.target_id) return setProblem("Choose a target.")
      if (data.scope === "campaign_run" && !data.campaign_run_id) {
        return setProblem("Choose a campaign run.")
      }
      if (scheduled) {
        const made = await createSchedule({
          ...data,
          name: name.trim(),
          frequency,
          recipient_ids: recipients,
        })
        toast.success("The schedule is saved.", {
          description: `The next report is produced ${FREQUENCY_LABEL[frequency].toLowerCase()}.`,
        })
        onDone(made, true)
      } else {
        const made = await generateReport(data)
        toast.success("Sentra is writing the report.")
        onDone(made, false)
      }
      onClose()
    } catch (failed) {
      const detail = failed instanceof ApiError ? failed.details?.[0] : undefined
      setProblem(
        detail?.message ??
          (failed instanceof ApiError ? failed.message : "The report could not be started."),
      )
    } finally {
      setBusy(false)
    }
  }

  const runs = (options?.campaign_runs ?? []).filter(
    (run) => !targetId || run.target_id === targetId,
  )
  const everybody = members?.length ? members : people
  const chosen = recipients.map(
    (id) =>
      everybody.find((one) => one.id === id) ?? {
        id,
        name: "A member who left",
      },
  )
  // Only a schedule that follows one target can produce a report after every campaign run.
  const perTarget = editing
    ? schedule?.scope === "target"
    : usePreset
      ? Boolean(presetTarget)
      : scope === "target"
  const needle = search.trim().toLowerCase()
  const matching = needle
    ? everybody.filter(
        (one) =>
          one.name.toLowerCase().includes(needle) ||
          (one.email ?? "").toLowerCase().includes(needle),
      )
    : everybody
  // 3a1: an address that belongs to nobody in this organization is named, with the rule why.
  const notAMember = ADDRESS.test(search.trim()) && matching.length === 0

  function pick(id: string, on: boolean) {
    setRecipients((before) => (on ? [...before, id] : before.filter((one) => one !== id)))
  }

  const summary = [
    `${TYPE_LABEL[type]} report`,
    schedule?.target ?? (preset?.target_id ? "One target" : "All targets"),
    type === "executive"
      ? (PERIODS.find((one) => one.value === period)?.label ?? `Last ${period} days`)
      : null,
    format.toUpperCase(),
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>
          {editing ? "Edit schedule" : scheduled ? "Schedule report" : "Generate report"}
        </DialogTitle>
        <DialogDescription>
          {editing
            ? "A change applies from the next report. The reports this schedule has already produced stay as they are."
            : "A report is written by Sentra and opens only after login. Nothing is attached to an e-mail."}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-5">
        {editing ? (
          <p className="rounded-[8px] border bg-muted/40 p-3 text-[13px]">
            <span className="block font-medium">{summary}</span>
            <span className="block text-text-secondary">
              To report something else, keep this schedule and add another one.
            </span>
          </p>
        ) : (
          <>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Report type</legend>
              <RadioGroup
                value={type}
                onValueChange={(value) => {
                  setType(value as ReportType)
                  if (value === "executive" && scope === "campaign_run") {
                    setScope("organization")
                  }
                }}
                className="gap-2"
              >
                {TYPES.map((one) => (
                  <Label
                    key={one}
                    htmlFor={`type-${one}`}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-[8px] border p-3 font-normal",
                      type === one && "border-primary bg-muted/40",
                    )}
                  >
                    <RadioGroupItem id={`type-${one}`} value={one} className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-medium">{TYPE_LABEL[one]} report</span>
                      <span className="block text-[13px] text-text-secondary">
                        {TYPE_DESCRIPTION[one]}
                      </span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>

            <div>
              <h3 className="mb-2 text-sm font-medium">Scope</h3>
              {preset && usePreset ? (
                <p className="flex flex-wrap items-center gap-2 rounded-[8px] border bg-muted/40 p-3 text-[13px]">
                  Using the dashboard filters: {preset.label}
                  <Button
                    type="button"
                    variant="link"
                    className="h-6 p-0 text-[13px]"
                    onClick={() => setUsePreset(false)}
                  >
                    Change
                  </Button>
                </p>
              ) : (
                <div className="space-y-2">
                  <RadioGroup
                    value={scope}
                    onValueChange={(value) => setScope(value as ReportScope)}
                    className="gap-2"
                  >
                    <Label
                      htmlFor="scope-organization"
                      className="flex items-center gap-2 font-normal"
                    >
                      <RadioGroupItem id="scope-organization" value="organization" />
                      All targets
                    </Label>
                    <Label htmlFor="scope-target" className="flex items-center gap-2 font-normal">
                      <RadioGroupItem id="scope-target" value="target" />
                      One target
                    </Label>
                    {type === "technical" && !scheduled && (
                      <Label htmlFor="scope-run" className="flex items-center gap-2 font-normal">
                        <RadioGroupItem id="scope-run" value="campaign_run" />
                        One campaign run
                      </Label>
                    )}
                  </RadioGroup>
                  {(scope === "target" || scope === "campaign_run") && (
                    <Select value={targetId} onValueChange={setTargetId}>
                      <SelectTrigger className="w-full" aria-label="Target">
                        <SelectValue placeholder="Choose a target" />
                      </SelectTrigger>
                      <SelectContent>
                        {(options?.targets ?? []).map((target) => (
                          <SelectItem key={target.id} value={target.id}>
                            {target.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {scope === "campaign_run" && (
                    <Select value={runId} onValueChange={setRunId}>
                      <SelectTrigger className="w-full" aria-label="Campaign run">
                        <SelectValue placeholder="Choose a campaign run" />
                      </SelectTrigger>
                      <SelectContent>
                        {runs.map((run) => (
                          <SelectItem key={run.id} value={run.id}>
                            {run.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {type === "executive" && (
                    <Select value={period} onValueChange={setPeriod}>
                      <SelectTrigger className="w-full" aria-label="Period">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERIODS.map((one) => (
                          <SelectItem key={one.value} value={one.value}>
                            {one.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>

            <div>
              <h3 id="report-format" className="mb-2 text-sm font-medium">
                Format
              </h3>
              <SegmentedControl
                labelledBy="report-format"
                value={format}
                onChange={setFormat}
                options={[
                  { value: "pdf", label: "PDF" },
                  { value: "json", label: "JSON" },
                ]}
              />
            </div>

            {unconfirmed !== null && unconfirmed > 0 && (
              <p className="rounded-[8px] border border-warning/40 bg-warning/5 p-3 text-[13px] text-warning">
                {unconfirmed} {unconfirmed === 1 ? "finding" : "findings"} in this scope still
                {unconfirmed === 1 ? " requires" : " require"} confirmation. They are listed
                separately and not counted in the summary.
              </p>
            )}

            <div className="flex items-start gap-2">
              <Checkbox
                id="schedule-this"
                checked={scheduled}
                onCheckedChange={(on) => {
                  setScheduled(Boolean(on))
                  // A schedule repeats, so it covers a target or the organization, never the one
                  // campaign run that has already ended.
                  if (on && scope === "campaign_run") setScope("target")
                }}
              />
              <Label htmlFor="schedule-this" className="font-normal">
                Schedule this report
                <span className="block text-xs text-muted-foreground">
                  Sentra produces it again and again and tells the recipients with a link.
                </span>
              </Label>
            </div>
          </>
        )}

        {scheduled && (
          <div className="space-y-4 rounded-[8px] border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-name">Name</Label>
              <Input
                id="schedule-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Monthly executive report"
                maxLength={120}
              />
            </div>
            <div>
              <h4 id="schedule-frequency" className="mb-2 text-sm font-medium">
                Frequency
              </h4>
              <RadioGroup
                value={frequency}
                onValueChange={(value) => setFrequency(value as Frequency)}
                aria-labelledby="schedule-frequency"
                className="gap-2"
              >
                {FREQUENCIES.filter(
                  (one) => one !== "after_each_run" || perTarget || frequency === one,
                ).map((one) => (
                  <Label
                    key={one}
                    htmlFor={`frequency-${one}`}
                    className="flex items-center gap-2 font-normal"
                  >
                    <RadioGroupItem id={`frequency-${one}`} value={one} />
                    {FREQUENCY_LABEL[one]}
                  </Label>
                ))}
              </RadioGroup>
              {(frequency === "after_each_run" || !perTarget) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  A report after every campaign run needs a target to follow
                  {perTarget
                    ? ": this one's own runs."
                    : ", so a report about every target can only be weekly or monthly."}
                </p>
              )}
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Recipients</legend>
              {chosen.length > 0 && (
                <ul className="mb-2 flex flex-wrap gap-2">
                  {chosen.map((one) => (
                    <li
                      key={one.id}
                      className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-[13px]"
                    >
                      {one.name}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={`Remove ${one.name}`}
                        onClick={() => pick(one.id, false)}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <Input
                id="recipient-search"
                value={search}
                aria-label="Search members by name or e-mail address"
                aria-describedby="recipient-rule"
                placeholder="Search members by name or e-mail address"
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault() // Enter adds a recipient; it doesn't save the dialog
                  if (matching.length === 1 && !recipients.includes(matching[0].id)) {
                    pick(matching[0].id, true)
                    setSearch("")
                  }
                }}
              />
              {notAMember ? (
                <p role="alert" className="mt-2 text-[13px] text-destructive">
                  {search.trim()} isn&apos;t a member of {organization}. Reports go only to members.
                </p>
              ) : (
                <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
                  {matching.map((member) => (
                    <li key={member.id} className="flex items-start gap-2">
                      <Checkbox
                        id={`recipient-${member.id}`}
                        className="mt-0.5"
                        checked={recipients.includes(member.id)}
                        onCheckedChange={(on) => pick(member.id, Boolean(on))}
                      />
                      <Label htmlFor={`recipient-${member.id}`} className="font-normal">
                        {member.name}
                        {member.email && (
                          <span className="block text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        )}
                      </Label>
                    </li>
                  ))}
                  {matching.length === 0 && (
                    <li className="text-[13px] text-muted-foreground">
                      No member matches “{search.trim()}”.
                    </li>
                  )}
                </ul>
              )}
              <p id="recipient-rule" className="mt-1 text-xs text-muted-foreground">
                Reports go only to members of {organization}, as a link they open after login.
              </p>
            </fieldset>
          </div>
        )}

        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
      </div>

      <DialogFooter className="mt-6">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" className="hover:bg-primary-hover" disabled={busy}>
          {busy
            ? "Saving…"
            : editing
              ? "Save changes"
              : scheduled
                ? "Save schedule"
                : "Generate report"}
        </Button>
      </DialogFooter>
    </form>
  )
}
