import type { Frequency, ReportFormat, ReportType } from "@/lib/reports"

/**
 * When the first report of a new schedule is produced, by the rule the server uses
 * (`schedules.next_time`): a weekly schedule seven days after it is saved, a monthly one on the
 * first of the next month at the time of day it was saved, both on Sentra's own clock in UTC, and
 * a schedule that follows campaign runs has no time of its own. The server's own `next_run_at`
 * replaces this the moment the schedule exists; this is only what is shown before.
 */
export function firstScheduledRun(frequency: Frequency, saved: Date): Date | null {
  if (frequency === "weekly") return new Date(saved.getTime() + 7 * 24 * 3600 * 1000)
  if (frequency === "monthly") {
    return new Date(
      Date.UTC(saved.getUTCFullYear(), saved.getUTCMonth() + 1, 1, saved.getUTCHours(), saved.getUTCMinutes(), saved.getUTCSeconds()),
    )
  }
  return null
}

export type PlanInput = {
  editing: boolean
  scheduled: boolean
  type: ReportType
  /** "All targets", "Payments Operations Agent", "Campaign run R-12" */
  scope: string
  /** Executive reports only */
  period: string | null
  format: ReportFormat
  name: string
  frequency: Frequency
  recipients: string[]
  unconfirmed: number | null
  now: Date
  /** How a moment is written, with its zone: the page's own, so the zone is always visible */
  at: (moment: Date) => string
}

/**
 * What pressing the dialog's button will do, in the order it happens. Generating, saving a
 * schedule and sending are different operations, and the lines say which one this is. No preview of
 * the content exists, and the plan says so instead of showing a sample.
 */
export function describeReportPlan(input: PlanInput): { heading: string; lines: string[] } {
  const what = `${input.type === "executive" ? "Executive" : "Technical"} report: ${input.scope}${input.period ? `, ${input.period}` : ""}, ${input.format.toUpperCase()}`
  const unconfirmed =
    input.unconfirmed && input.unconfirmed > 0
      ? `${input.unconfirmed} ${input.unconfirmed === 1 ? "finding" : "findings"} that still ${input.unconfirmed === 1 ? "requires" : "require"} confirmation will be listed separately, not counted in the summary.`
      : null
  const who =
    input.recipients.length > 0
      ? `${input.recipients.length} ${input.recipients.length === 1 ? "member is" : "members are"} told with a link that opens only after login: ${input.recipients.join(", ")}. Nothing is attached to an e-mail.`
      : "No recipient is chosen yet."

  if (input.editing) {
    return {
      heading: "What saving will do",
      lines: [
        `Changes the name, the frequency and the recipients of this schedule (${what}).`,
        "The change applies from the next report; the reports it has produced stay as they are.",
        "Saving does not produce or send a report now.",
        who,
      ],
    }
  }
  if (!input.scheduled) {
    return {
      heading: "What generating will do",
      lines: [
        `Sentra writes one ${what}.`,
        "It appears under Reports when it is ready and opens only after login. Nothing is sent to anyone.",
        "There is no preview: the content is created when you press Generate report, from the data as it is then.",
        ...(unconfirmed ? [unconfirmed] : []),
      ],
    }
  }
  const first = firstScheduledRun(input.frequency, input.now)
  const when =
    input.frequency === "after_each_run"
      ? "A report is produced after every finished campaign run of the target; it has no time of its own."
      : `The first report is produced about ${first ? input.at(first) : "later"}${input.frequency === "weekly" ? ", then every 7 days" : ", then on the 1st of every month"}. The schedule has no time zone of its own: it follows Sentra's clock in UTC.`
  return {
    heading: "What saving will do",
    lines: [
      `Saves a schedule${input.name.trim() ? ` named “${input.name.trim()}”` : ""} for a ${what}.`,
      "Saving does not produce or send a report now. Use “Run now” on the schedule to produce one.",
      when,
      who,
      ...(unconfirmed ? [unconfirmed] : []),
    ],
  }
}

/** A moment with its zone beside it and in UTC, because the schedule's own clock is UTC: "1 Dec 2026, 16:30 GMT+6 (10:30 UTC)". */
export function atWithZone(moment: Date): string {
  const local = moment.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
  const utc = moment.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
  return `${local} (${utc} UTC)`
}
