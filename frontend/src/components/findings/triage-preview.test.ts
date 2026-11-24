import assert from "node:assert/strict"
import test from "node:test"

import type { TriageOptions } from "@/lib/findings"

import { onlyJudgeSupports } from "./judge-only.ts"
import { type TriageDraft, triagePreview } from "./triage-preview.ts"

const OPTIONS = {
  code: "F-001",
  title: "x",
  status: "requires_confirmation",
  open: true,
  requires_confirmation: true,
  severity: "high",
  calculated_severity: "high",
  severity_provisional: false,
  severity_adjusted: false,
  severity_justification: "",
  owner: null,
  suggested_owner: null,
  members: [{ id: "u1", name: "Maya Chen" }],
  duplicates: [{ code: "F-002", title: "Same weakness", severity: "high", status: "new" }],
} as unknown as TriageOptions
const BLANK: TriageDraft = { decision: "", reason: "", mergeInto: "", severity: "high", justification: "", ownerId: "", comment: "" }

test("nothing is chosen for the person: an untouched draft changes nothing and asks for a decision", () => {
  const p = triagePreview("F-001", OPTIONS, BLANK)
  assert.equal(p.changes, false)
  assert.equal(p.effects.length, 0)
  assert.ok(p.missing.decision)
})

test("confirming a finding that waits for confirmation says it counts towards the risk score only once confirmed", () => {
  const p = triagePreview("F-001", OPTIONS, { ...BLANK, decision: "confirm" })
  assert.equal(p.changes, true)
  assert.match(p.effects[0], /requires confirmation → confirmed/)
  assert.match(p.effects[0], /does not count towards the target's risk score until then/)
})

test("confirming an already confirmed finding changes nothing", () => {
  const p = triagePreview("F-001", { ...OPTIONS, status: "confirmed", requires_confirmation: false }, { ...BLANK, decision: "confirm" })
  assert.equal(p.changes, false)
  assert.match(p.effects[0], /already confirmed/)
})

test("a false positive needs its reason", () => {
  assert.ok(triagePreview("F-001", OPTIONS, { ...BLANK, decision: "false_positive" }).missing.reason)
  assert.equal(triagePreview("F-001", OPTIONS, { ...BLANK, decision: "false_positive", reason: "Mock data" }).missing.reason, undefined)
})

test("a merge names the surviving record, says evidence is not moved, and needs a target", () => {
  assert.ok(triagePreview("F-001", OPTIONS, { ...BLANK, decision: "merge" }).missing.mergeInto)
  const p = triagePreview("F-001", OPTIONS, { ...BLANK, decision: "merge", mergeInto: "F-002" })
  assert.match(p.effects[0], /merged into F-002/)
  assert.match(p.effects[0], /never moved/)
})

test("a merge target that is no longer on the list counts as missing, not as chosen", () => {
  assert.ok(triagePreview("F-001", OPTIONS, { ...BLANK, decision: "merge", mergeInto: "F-099" }).missing.mergeInto)
})

test("changing the severity needs a justification and keeps the calculated one visible", () => {
  const p = triagePreview("F-001", OPTIONS, { ...BLANK, severity: "low" })
  assert.ok(p.missing.justification)
  assert.match(p.effects[0], /high → low/)
  assert.match(p.effects[0], /calculated one \(high\)/)
})

test("an owner change and a comment alone are real changes, with no decision needed", () => {
  const p = triagePreview("F-001", OPTIONS, { ...BLANK, ownerId: "u1", comment: "Looking at it" })
  assert.equal(p.changes, true)
  assert.equal(p.missing.decision, undefined)
  assert.ok(p.effects.some((e) => /Maya Chen/.test(e)))
})

test("onlyJudgeSupports is true only when the judge alone met", () => {
  const d = (methods: [string, string][]) => ({ methods: methods.map(([method, outcome]) => ({ method, outcome })) }) as never
  assert.equal(onlyJudgeSupports(d([["llm_judge", "met"]])), true)
  assert.equal(onlyJudgeSupports(d([["canary_token", "met"], ["llm_judge", "met"]])), false)
  assert.equal(onlyJudgeSupports(d([["canary_token", "not_met"], ["llm_judge", "met"]])), true)
  assert.equal(onlyJudgeSupports(d([["llm_judge", "not_met"]])), false)
  assert.equal(onlyJudgeSupports(null), false)
})
