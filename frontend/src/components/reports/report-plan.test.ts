import assert from "node:assert/strict"
import test from "node:test"

import { type PlanInput, describeReportPlan, firstScheduledRun } from "./report-plan.ts"

const base: PlanInput = { editing: false, scheduled: false, type: "executive", scope: "All targets", period: "Last 90 days", format: "pdf", name: "", frequency: "monthly", recipients: [] as string[], unconfirmed: null, now: new Date("2026-11-15T10:30:00Z"), at: (d: Date) => d.toISOString() }

test("weekly: seven days after saving, monthly: the 1st of next month at the same UTC time, runs: no time", () => {
  assert.equal(firstScheduledRun("weekly", new Date("2026-11-15T10:30:00Z"))!.toISOString(), "2026-11-22T10:30:00.000Z")
  assert.equal(firstScheduledRun("monthly", new Date("2026-11-15T10:30:00Z"))!.toISOString(), "2026-12-01T10:30:00.000Z")
  assert.equal(firstScheduledRun("monthly", new Date("2026-12-31T23:59:00Z"))!.toISOString(), "2027-01-01T23:59:00.000Z")
  assert.equal(firstScheduledRun("after_each_run", new Date()), null)
})

test("generating once says nothing is sent, that there is no preview, and that it is not a schedule", () => {
  const p = describeReportPlan({ ...base })
  assert.match(p.heading, /generating/)
  assert.match(p.lines.join(" "), /Nothing is sent to anyone/)
  assert.match(p.lines.join(" "), /There is no preview/)
  assert.doesNotMatch(p.lines.join(" "), /schedule/i)
})

test("saving a schedule produces and sends nothing now, and says when the first report comes and in which clock", () => {
  const p = describeReportPlan({ ...base, scheduled: true, name: "Board", recipients: ["Nadia Karim"] })
  const text = p.lines.join(" ")
  assert.match(text, /Saving does not produce or send a report now/)
  assert.match(text, /2026-12-01T10:30:00.000Z/)
  assert.match(text, /UTC/)
  assert.match(text, /Nadia Karim/)
  assert.match(text, /“Board”/)
})

test("a schedule with no recipient says so", () => {
  assert.match(describeReportPlan({ ...base, scheduled: true }).lines.join(" "), /No recipient is chosen yet/)
})

test("a schedule after each run has no time of its own", () => {
  assert.match(describeReportPlan({ ...base, scheduled: true, frequency: "after_each_run" }).lines.join(" "), /no time of its own/)
})

test("editing says the change applies from the next report", () => {
  const p = describeReportPlan({ ...base, editing: true, scheduled: true })
  assert.match(p.lines.join(" "), /applies from the next report/)
})

test("findings that still require confirmation are said to be listed separately", () => {
  assert.match(describeReportPlan({ ...base, unconfirmed: 3 }).lines.join(" "), /3 findings that still require confirmation/)
  assert.match(describeReportPlan({ ...base, unconfirmed: 1 }).lines.join(" "), /1 finding that still requires confirmation/)
})
