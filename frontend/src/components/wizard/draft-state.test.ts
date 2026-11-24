// Run with: node --test src/components/wizard/draft-state.test.ts (no test library is installed)
import assert from "node:assert/strict"
import { test } from "node:test"

import { CLEAN, type DraftEvent, type DraftFeedback, draftReducer, needsSave } from "./draft-state.ts"

const run = (...events: DraftEvent[]): DraftFeedback => events.reduce(draftReducer, CLEAN)
const AT = "2026-11-15T10:00:00.000Z"

test("a change makes the draft unsaved, a save makes it saving and then saved", () => {
  assert.equal(run({ type: "edited" }).phase, "unsaved")
  assert.equal(run({ type: "edited" }, { type: "saveStarted", edit: 1 }).phase, "saving")
  const saved = run({ type: "edited" }, { type: "saveStarted", edit: 1 }, { type: "saved", edit: 1, at: AT })
  assert.equal(saved.phase, "saved")
  assert.equal(saved.savedAt, AT)
  assert.equal(needsSave(saved), false)
})

test("an older save answer never marks newer edits as saved", () => {
  const state = run(
    { type: "edited" },
    { type: "saveStarted", edit: 1 },
    { type: "edited" }, // the person typed again while save 1 was on its way
    { type: "saved", edit: 1, at: AT },
  )
  assert.equal(state.phase, "unsaved")
  assert.equal(state.savedEdit, 1)
  assert.equal(needsSave(state), true)
})

test("answers that arrive out of order keep the newest acknowledgement", () => {
  const state = run(
    { type: "edited" },
    { type: "saveStarted", edit: 1 },
    { type: "edited" },
    { type: "saveStarted", edit: 2 },
    { type: "saved", edit: 2, at: "2026-11-15T10:00:02.000Z" },
    { type: "saved", edit: 1, at: "2026-11-15T10:00:01.000Z" }, // the first answer arrives last
  )
  assert.equal(state.phase, "saved")
  assert.equal(state.savedEdit, 2)
  assert.equal(state.savedAt, "2026-11-15T10:00:02.000Z")
})

test("a failure is shown only for the latest edit, and a late failure of an older save is ignored", () => {
  const failed = run({ type: "edited" }, { type: "saveStarted", edit: 1 }, { type: "failed", edit: 1, message: "Storage is full" })
  assert.equal(failed.phase, "failed")
  assert.equal(failed.error, "Storage is full")
  assert.equal(needsSave(failed), true)

  const lateFailure = run(
    { type: "edited" },
    { type: "saveStarted", edit: 1 },
    { type: "edited" },
    { type: "saveStarted", edit: 2 },
    { type: "saved", edit: 2, at: AT },
    { type: "failed", edit: 1, message: "late" },
  )
  assert.equal(lateFailure.phase, "saved")
  assert.equal(lateFailure.error, null)
})

test("a retry after a failure can still be acknowledged", () => {
  const state = run(
    { type: "edited" },
    { type: "saveStarted", edit: 1 },
    { type: "failed", edit: 1, message: "offline" },
    { type: "saveStarted", edit: 1 },
    { type: "saved", edit: 1, at: AT },
  )
  assert.equal(state.phase, "saved")
  assert.equal(state.error, null)
})

test("where nothing can be kept the draft stays unsupported and is never reported as saved", () => {
  const state = run({ type: "unsupported" }, { type: "edited" }, { type: "saveStarted", edit: 1 }, { type: "saved", edit: 1, at: AT })
  assert.equal(state.phase, "unsupported")
  assert.equal(state.savedAt, null)
  assert.equal(needsSave(state), false)
})

test("a restored draft is shown as kept, and the next edit makes it unsaved", () => {
  const restored = run({ type: "restored", at: AT })
  assert.equal(restored.phase, "saved")
  assert.equal(run({ type: "restored", at: AT }, { type: "edited" }).phase, "unsaved")
})

test("a save that starts for an edit that is no longer the latest does not claim to be saving it", () => {
  const state = run({ type: "edited" }, { type: "edited" }, { type: "saveStarted", edit: 1 })
  assert.equal(state.phase, "unsaved")
})
