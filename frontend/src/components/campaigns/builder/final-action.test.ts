// Run with: node --test src/components/campaigns/builder/final-action.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { entryFor } from "./entry.ts"
import { finalAction } from "./final-action.ts"

const base = { targetName: "Loan Policy Q&A", when: "Every Monday at 02:00 (Asia/Dhaka)" }

test("approval required: the button submits, whatever the schedule, and nothing is said to start", () => {
  for (const immediate of [true, false]) {
    const a = finalAction({ ...base, needsApproval: true, immediate })
    assert.equal(a.operation, "submit")
    assert.equal(a.label, "Submit for approval")
    assert.match(a.effect, /Nothing is sent to the target and nothing runs before they approve/)
  }
})

test("no approval and immediate: the button says it starts a run and the sentence says requests are sent", () => {
  const a = finalAction({ ...base, needsApproval: false, immediate: true })
  assert.equal(a.operation, "start")
  assert.equal(a.label, "Save and start run")
  assert.match(a.effect, /first run starts as soon as you save/)
  assert.match(a.effect, /sends test requests to Loan Policy Q&A/)
  assert.doesNotMatch(a.effect, /sends nothing|Nothing is sent/i)
})

test("no approval and later: the button saves, and the schedule is named", () => {
  const a = finalAction({ ...base, needsApproval: false, immediate: false })
  assert.equal(a.operation, "save")
  assert.equal(a.label, "Save campaign")
  assert.match(a.effect, /runs every Monday at 02:00/)
  assert.match(a.effect, /Nothing is sent to the target before then/)
})

test("only an outcome that sends requests says so", () => {
  const sends = (a: ReturnType<typeof finalAction>) => /sends test requests/.test(a.effect)
  assert.equal(sends(finalAction({ ...base, needsApproval: false, immediate: true })), true)
  assert.equal(sends(finalAction({ ...base, needsApproval: false, immediate: false })), false)
  assert.equal(sends(finalAction({ ...base, needsApproval: true, immediate: true })), false)
})

test("entry: no draft starts fresh, a draft alone is restored", () => {
  assert.equal(entryFor({ hasDraft: false, draftTargetId: "" }), "fresh")
  assert.equal(entryFor({ hasDraft: false, draftTargetId: "", linkTarget: "b" }), "fresh")
  assert.equal(entryFor({ hasDraft: true, draftTargetId: "a" }), "restore")
})

test("entry: a link that names something else than the draft asks, and never drops the draft silently", () => {
  assert.equal(entryFor({ hasDraft: true, draftTargetId: "a", linkTarget: "b", linkSuite: "QUICK" }), "ask")
  assert.equal(entryFor({ hasDraft: true, draftTargetId: "a", linkFrom: "C-1" }), "ask")
  assert.equal(entryFor({ hasDraft: true, draftTargetId: "a", linkTarget: "a", linkSuite: "QUICK" }), "ask")
})

test("entry: a link to the very target of the draft, with nothing else, keeps the draft", () => {
  assert.equal(entryFor({ hasDraft: true, draftTargetId: "a", linkTarget: "a" }), "restore")
})
