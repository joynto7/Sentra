import assert from "node:assert/strict"
import test from "node:test"

import type { Target } from "@/lib/targets"

import { draftEntryStatus } from "./draft-entry.ts"

const DRAFT = { targetId: "t1", suites: 2, step: 2, savedAt: "2026-11-14T10:00:00Z" }
const T = (over: Partial<Target>) => ({ id: "t1", name: "Support", status: "verified", archived_at: null, ...over }) as Target

test("a verified, available target gives a usable draft that is checked again on opening", () => {
  const s = draftEntryStatus(DRAFT, T({}), true)!
  assert.equal(s.state, "ok")
  assert.equal(s.canContinue, true)
  assert.match(s.message, /checked again against the current suites/)
})

test("a target the server no longer knows is gone: opening asks again, nothing is substituted", () => {
  const s = draftEntryStatus(DRAFT, null, true)!
  assert.equal(s.state, "gone")
  assert.match(s.message, /nothing is substituted/)
})

test("an archived or unverified target says so and keeps the other choices", () => {
  assert.equal(draftEntryStatus(DRAFT, T({ status: "archived", archived_at: "2026-11-10" }), true)!.state, "archived")
  const u = draftEntryStatus(DRAFT, T({ status: "unverified" }), true)!
  assert.equal(u.state, "unverified")
  assert.match(u.message, /keeps your other choices/)
})

test("a role that cannot create campaigns cannot continue the draft", () => {
  const s = draftEntryStatus(DRAFT, T({}), false)!
  assert.equal(s.state, "forbidden")
  assert.equal(s.canContinue, false)
})

test("while the target is still being asked nothing is claimed", () => {
  assert.equal(draftEntryStatus(DRAFT, undefined, true), null)
})

test("a draft with no target chosen continues from the target step", () => {
  assert.equal(draftEntryStatus({ ...DRAFT, targetId: "" }, undefined, true)!.state, "no-target")
})
