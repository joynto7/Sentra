import assert from "node:assert/strict"
import test from "node:test"

import type { RemediationPage } from "@/lib/remediation"

import { remediationJourney } from "./remediation-journey.ts"

const base = (over: Partial<RemediationPage> & { status?: string } = {}): RemediationPage => {
  const { status, ...rest } = over
  return {
    blocker: null,
    job: null,
    versions: [],
    current: status ? ({ version: 2, status, decided_by: "Nadia Karim" } as never) : null,
    review: { can_edit: false, can_submit: false, can_approve: false, cannot_approve: null, approvers: [], on_approval: [] },
    comments: [],
    changes: [],
    retests: [],
    in_effect: null,
    ...rest,
  } as unknown as RemediationPage
}
const by = (page: RemediationPage) => Object.fromEntries(remediationJourney(page).map((s) => [s.id, s]))

test("with no proposal only the first stage is current; the rest wait", () => {
  const s = by(base())
  assert.equal(s.proposal.state, "current")
  assert.deepEqual([s.review.state, s.application.state, s.retest.state, s.outcome.state], ["upcoming", "upcoming", "upcoming", "upcoming"])
})

test("a draft is not with the approvers; an awaiting version names who approves", () => {
  assert.equal(by(base({ status: "draft" })).review.state, "current")
  const w = by(base({ status: "awaiting_approval" })).review
  assert.equal(w.state, "waiting")
  assert.match(w.who, /not the person who last adapted/)
})

test("approval is a stage that is only done once the server says approved", () => {
  assert.equal(by(base({ status: "awaiting_approval" })).review.state, "waiting")
  assert.equal(by(base({ status: "approved" })).review.state, "done")
  assert.equal(by(base({ status: "approved" })).application.state, "current")
})

test("rejected is a problem with a way forward, and nothing after it starts", () => {
  const s = by(base({ status: "rejected" }))
  assert.equal(s.review.state, "problem")
  assert.match(s.review.next!, /Adapt the proposal/)
  assert.equal(s.application.state, "upcoming")
})

test("open changes inside the application are counted in the next action", () => {
  const s = by(base({ status: "approved", changes: [{ status: "open" }, { status: "implemented" }, { status: "open" }] as never }))
  assert.match(s.application.next!, /Mark the 2 changes/)
})

test("an approved fix with no retest has an unknown outcome, never fixed", () => {
  const s = by(base({ status: "approved" }))
  assert.equal(s.retest.state, "upcoming")
  assert.equal(s.outcome.state, "upcoming")
  assert.match(s.outcome.status, /no finished retest/)
})

test("only a closed retest gives a fixed outcome; still open and inconclusive are problems", () => {
  const retest = (verdict: string, extra = {}) => [{ number: 1, version: 2, running: false, verdict, verdict_label: verdict, status_label: "Finished", out_of_date: false, ...extra }] as never
  assert.equal(by(base({ status: "effective", retests: retest("closed") })).outcome.state, "done")
  assert.equal(by(base({ status: "ineffective", retests: retest("still_open") })).outcome.state, "problem")
  const inc = by(base({ status: "approved", retests: retest("inconclusive") }))
  assert.equal(inc.outcome.state, "problem")
  assert.match(inc.outcome.status, /nothing is marked fixed/)
})

test("a rollback that took the proof out of the traffic is not a fixed outcome", () => {
  const s = by(base({ status: "effective", retests: [{ number: 1, version: 2, running: false, verdict: "closed", verdict_label: "Fixed and Verified", status_label: "Finished", out_of_date: true }] as never }))
  assert.notEqual(s.outcome.state, "done")
})

test("a running retest keeps the outcome unknown", () => {
  const s = by(base({ status: "approved", retests: [{ number: 1, version: 2, running: true, verdict: null }] as never }))
  assert.equal(s.retest.state, "current")
  assert.equal(s.outcome.state, "upcoming")
})
