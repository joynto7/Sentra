// Run with: node --test src/components/threat-models/model-journey.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { type JourneyInput, nextStep, threatModelStages } from "./model-journey.ts"

const BASE: JourneyInput = { targetId: "t1", blockerCode: null, blocker: null, job: null, versions: [], baselineOnly: false, canManage: true }
const v = (version: number, status: "draft" | "approved", extra = {}) => ({ version, status, ai_generated: true, created_at: "2026-11-14T10:00:00Z", approved_at: status === "approved" ? "2026-11-15T10:00:00Z" : null, approved_by: status === "approved" ? "Arif Hossain" : null, ...extra })
const states = (i: JourneyInput) => Object.fromEntries(threatModelStages(i).map((s) => [s.id, s.state]))

test("an unverified target: the profile stage is blocked on the developer, nothing downstream pretends", () => {
  const s = threatModelStages({ ...BASE, blockerCode: "not_verified" })
  assert.equal(s[0].state, "blocked"); assert.equal(s[0].who, "AI Application Developer"); assert.match(s[0].href!, /\/verify$/)
  assert.deepEqual(Object.values(states({ ...BASE, blockerCode: "not_verified" })).slice(1), ["upcoming", "upcoming", "upcoming", "upcoming"])
})

test("nothing generated yet: the analyst may generate, a manager waits for an analyst", () => {
  assert.equal(states(BASE).generation, "ready")
  const m = threatModelStages({ ...BASE, canManage: false }).find((x) => x.id === "generation")!
  assert.equal(m.state, "waiting"); assert.equal(m.who, "Security Analyst")
})

test("generation in progress is working, failed is a problem the analyst can retry", () => {
  assert.equal(states({ ...BASE, job: { status: "running", message: null } }).generation, "working")
  assert.equal(states({ ...BASE, job: { status: "failed", message: "x" } }).generation, "ready")
  assert.equal(states({ ...BASE, canManage: false, job: { status: "failed", message: "x" } }).generation, "blocked")
})

test("a generated draft is never presented as approved, and nothing is recommended from it", () => {
  const i = { ...BASE, versions: [v(1, "draft")] }
  const s = states(i)
  assert.deepEqual([s.generation, s.review, s.approval, s.suites], ["done", "ready", "ready", "blocked"])
  const approval = threatModelStages(i).find((x) => x.id === "approval")!
  assert.match(approval.detail, /not approved, so no campaign can be based on a threat model yet/)
})

test("a newer draft over an approved version: campaigns still use the approved one, and says which", () => {
  const i = { ...BASE, versions: [v(3, "draft"), v(2, "approved")] }
  const s = threatModelStages(i)
  assert.match(s.find((x) => x.id === "approval")!.detail, /Campaigns still use v2/)
  assert.equal(s.find((x) => x.id === "suites")!.state, "ready")
  assert.match(s.find((x) => x.id === "suites")!.detail, /v2, the approved version/)
})

test("an approved newest version completes the path and opens the recommendations", () => {
  const s = threatModelStages({ ...BASE, versions: [v(2, "approved")] })
  assert.deepEqual(s.map((x) => x.state), ["done", "done", "done", "done", "ready"])
  assert.match(s[4].href!, /recommendations$/)
})

test("baseline-only generation is said, not hidden", () => {
  const s = threatModelStages({ ...BASE, baselineOnly: true, versions: [v(1, "draft")] })
  assert.match(s[1].detail, /baseline threats only/)
})

test("the next step names the role that has to act", () => {
  const manager = threatModelStages({ ...BASE, canManage: false, versions: [v(1, "draft")] })
  assert.match(nextStep(manager, false), /waiting for a Security Analyst/)
  assert.match(nextStep(threatModelStages({ ...BASE, versions: [v(1, "draft")] }), true), /Next for you: reviewed/)
})

test("a draft whose profile needs another review: the profile waits, but the next step is still the review and approval", () => {
  const i = { ...BASE, blockerCode: "profile_not_reviewed" as const, versions: [v(1, "draft")] }
  const stages = threatModelStages(i)
  assert.equal(stages[0].state, "waiting")
  assert.match(stages[0].detail, /v1 was made from an earlier profile/)
  assert.match(nextStep(threatModelStages({ ...i, canManage: false }), false), /Reviewed: waiting for a Security Analyst/)
  assert.match(nextStep(stages, true), /Next for you: reviewed/)
})
