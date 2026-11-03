"use client"

import { useState } from "react"

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
import {
  FREQUENCY_LABEL,
  type Frequency,
  type Schedule,
  type ScheduleInput,
  type ScheduleKind,
  WEEKDAYS,
} from "@/lib/campaigns"
import { cn } from "@/lib/utils"

/** What the analyst chose in the builder's step 5, before it becomes a ScheduleInput. */
export type ScheduleDraft = {
  kind: ScheduleKind
  runAt: string // a local date and time, "2026-11-12T02:00"
  frequency: Frequency
  weekday: number
  dayOfMonth: number
  atTime: string // "02:00"
}

export const EMPTY_DRAFT: ScheduleDraft = {
  kind: "immediately",
  runAt: "",
  frequency: "weekly",
  weekday: 0,
  dayOfMonth: 1,
  atTime: "02:00",
}

export function draftOf(schedule: Schedule | null): ScheduleDraft {
  if (!schedule) return EMPTY_DRAFT
  return {
    kind: schedule.kind,
    runAt: schedule.run_at ? schedule.run_at.slice(0, 16) : "",
    frequency: schedule.frequency ?? "weekly",
    weekday: schedule.weekday ?? 0,
    dayOfMonth: schedule.day_of_month ?? 1,
    atTime: (schedule.at_time ?? "02:00").slice(0, 5),
  }
}

/** The draft as the API takes it (UC-5.1 step 5); a time without an offset is read in the
 * campaign's own time zone, which is what the analyst typed. */
export function scheduleInput(draft: ScheduleDraft): ScheduleInput {
  if (draft.kind === "immediately") return { kind: "immediately" }
  if (draft.kind === "once") return { kind: "once", run_at: draft.runAt || null }
  return {
    kind: "recurring",
    frequency: draft.frequency,
    at_time: draft.atTime,
    weekday: draft.frequency === "weekly" ? draft.weekday : null,
    day_of_month: draft.frequency === "monthly" ? draft.dayOfMonth : null,
  }
}

/** The choice is wrong before it is sent, so the builder can say so without a round trip. */
export function scheduleProblem(draft: ScheduleDraft): string | undefined {
  if (draft.kind === "once") {
    if (!draft.runAt) return "Choose the date and time."
    if (new Date(draft.runAt).getTime() <= Date.now()) return "Choose a time in the future."
  }
  if (draft.kind === "recurring" && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(draft.atTime)) {
    return "Enter the time as hours and minutes, such as 02:00."
  }
}

const CHOICES: { value: ScheduleKind; label: string; help: string }[] = [
  { value: "immediately", label: "Immediately", help: "The first run starts as soon as the campaign is saved." },
  { value: "once", label: "At a time", help: "One run at a moment you choose." },
  { value: "recurring", label: "On a recurring schedule", help: "Every day, week or month." },
]

/**
 * UC-5.1 step 5: when the campaign runs. The same fields serve the builder (Screen 34) and the
 * campaign's own page, where a saved schedule is changed (FR-5.3).
 */
export function ScheduleFields({
  draft,
  onChange,
  timeZone,
  error,
  disabled,
  withImmediately = true,
  needsApproval = false,
  idPrefix = "schedule",
}: {
  draft: ScheduleDraft
  onChange: (draft: ScheduleDraft) => void
  timeZone: string
  error?: string
  disabled?: boolean
  /** The builder offers "immediately"; a campaign that already exists is launched instead. */
  withImmediately?: boolean
  /** FR-5.2: where the organization requires approval, nothing starts until a decision is made */
  needsApproval?: boolean
  idPrefix?: string
}) {
  const set = (changes: Partial<ScheduleDraft>) => onChange({ ...draft, ...changes })
  const offered = withImmediately ? CHOICES : CHOICES.filter((choice) => choice.value !== "immediately")
  const choices = needsApproval
    ? offered.map((choice) =>
        choice.value === "immediately"
          ? { ...choice, help: "The first run starts as soon as a Security Manager has approved it." }
          : choice,
      )
    : offered
  const errorId = `${idPrefix}-error`
  return (
    <div className="space-y-4">
      <RadioGroup
        value={draft.kind}
        onValueChange={(value) => set({ kind: value as ScheduleKind })}
        disabled={disabled}
        aria-label="When the campaign runs"
        aria-describedby={error ? errorId : undefined}
        className="gap-2"
      >
        {choices.map((choice) => (
          <div
            key={choice.value}
            className={cn(
              "flex items-start gap-3 rounded-[7px] border p-3",
              draft.kind === choice.value && "border-primary bg-primary/5",
            )}
          >
            <RadioGroupItem value={choice.value} id={`${idPrefix}-${choice.value}`} className="mt-0.5" />
            <div className="min-w-0">
              <Label htmlFor={`${idPrefix}-${choice.value}`} className="font-medium">
                {choice.label}
              </Label>
              <p className="text-xs text-muted-foreground">{choice.help}</p>
            </div>
          </div>
        ))}
      </RadioGroup>

      {draft.kind === "once" && (
        <div className="max-w-xs">
          <Label htmlFor={`${idPrefix}-run-at`}>Date and time</Label>
          <Input
            id={`${idPrefix}-run-at`}
            type="datetime-local"
            value={draft.runAt}
            disabled={disabled}
            onChange={(event) => set({ runAt: event.target.value })}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : `${idPrefix}-zone`}
            className="mt-1.5 h-9"
          />
        </div>
      )}

      {draft.kind === "recurring" && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40">
            <Label htmlFor={`${idPrefix}-frequency`}>How often</Label>
            <Select
              value={draft.frequency}
              onValueChange={(value) => set({ frequency: value as Frequency })}
              disabled={disabled}
            >
              <SelectTrigger id={`${idPrefix}-frequency`} className="mt-1.5 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((frequency) => (
                  <SelectItem key={frequency} value={frequency}>
                    {FREQUENCY_LABEL[frequency]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draft.frequency === "weekly" && (
            <div className="min-w-40">
              <Label htmlFor={`${idPrefix}-weekday`}>On</Label>
              <Select
                value={String(draft.weekday)}
                onValueChange={(value) => set({ weekday: Number(value) })}
                disabled={disabled}
              >
                <SelectTrigger id={`${idPrefix}-weekday`} className="mt-1.5 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((day, index) => (
                    <SelectItem key={day} value={String(index)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {draft.frequency === "monthly" && (
            <div className="w-28">
              <Label htmlFor={`${idPrefix}-day`}>Day</Label>
              <Input
                id={`${idPrefix}-day`}
                type="number"
                min={1}
                max={28}
                inputMode="numeric"
                value={draft.dayOfMonth}
                disabled={disabled}
                onChange={(event) => set({ dayOfMonth: Number(event.target.value) })}
                className="tabular mt-1.5 h-9"
              />
            </div>
          )}

          <div className="w-32">
            <Label htmlFor={`${idPrefix}-at-time`}>At</Label>
            <Input
              id={`${idPrefix}-at-time`}
              type="time"
              value={draft.atTime}
              disabled={disabled}
              onChange={(event) => set({ atTime: event.target.value })}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : `${idPrefix}-zone`}
              className="tabular mt-1.5 h-9"
            />
          </div>
        </div>
      )}

      {draft.kind !== "immediately" && (
        <p id={`${idPrefix}-zone`} className="text-xs text-muted-foreground">
          Times are in the campaign&apos;s time zone ({timeZone}). A day of the month is at most 28, so it exists
          in every month.
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** A hook for the pages that edit one schedule: the draft, its problem and whether it changed. */
export function useScheduleDraft(schedule: Schedule | null) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftOf(schedule))
  return { draft, setDraft, problem: scheduleProblem(draft) }
}
