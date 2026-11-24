import assert from "node:assert/strict"
import test from "node:test"

import { type GovernanceInput, governanceChecklist, needsAttention } from "./governance-readiness.ts"

const BASE: GovernanceInput = {
  activeMembers: 12, suspendedMembers: 0, pendingInvitations: 0, expiredInvitations: 0,
  mfaRequired: true, membersWithoutMfa: 0, scopeApproval: true, securityManagers: 2,
  sso: { connected: false, emailDomain: null, testedAt: null },
  retention: { usingDefaults: false, changedBy: "Tom Becker", evidenceDays: 180, campaignDays: 365, reportDays: 730, lastRunFailures: 0, lastRunPostponed: 0 },
  data: { localOnly: false, externalTasks: 3 },
}
const by = (i: GovernanceInput) => Object.fromEntries(governanceChecklist(i).map((x) => [x.id, x]))

test("optional single sign-on is never a task to do, and a connection is saved and tested, not proven", () => {
  assert.equal(by(BASE).sso.state, "optional")
  const connected = by({ ...BASE, sso: { connected: true, emailDomain: "x.com", testedAt: "2026-11-01" } }).sso
  assert.notEqual(connected.state, "attention")
  assert.match(connected.detail, /only proof it works end to end/)
  assert.match(by({ ...BASE, sso: { connected: true, emailDomain: "x.com", testedAt: null } }).sso.detail, /was not tested/)
})

test("two-step verification is done only when required and everybody has it", () => {
  assert.equal(by(BASE).mfa.state, "done")
  assert.equal(by({ ...BASE, membersWithoutMfa: 3 }).mfa.state, "attention")
  assert.equal(by({ ...BASE, mfaRequired: false, membersWithoutMfa: 0 }).mfa.state, "attention")
})

test("members: alone is open, expired invitations need sending again", () => {
  assert.equal(by({ ...BASE, activeMembers: 1 }).members.state, "attention")
  assert.match(by({ ...BASE, activeMembers: 1 }).members.detail, /Nobody else can log in yet/)
  const exp = by({ ...BASE, expiredInvitations: 2 }).members
  assert.equal(exp.state, "attention")
  assert.match(exp.detail, /2 invitations have expired/)
})

test("retention: defaults are optional, a failed clean-up needs attention, and no wording claims compliance", () => {
  assert.equal(by({ ...BASE, retention: { ...BASE.retention!, usingDefaults: true } }).retention.state, "optional")
  assert.equal(by({ ...BASE, retention: { ...BASE.retention!, lastRunFailures: 2 } }).retention.state, "attention")
  const text = JSON.stringify(governanceChecklist(BASE))
  assert.doesNotMatch(text, /complian|certif|GDPR|guarantee/i)
})

test("a retention or data reading that failed is left out instead of invented", () => {
  const ids = governanceChecklist({ ...BASE, retention: null, data: null }).map((x) => x.id)
  assert.ok(!ids.includes("retention") && !ids.includes("data"))
})

test("what needs attention comes first for a returning administrator", () => {
  const items = governanceChecklist({ ...BASE, membersWithoutMfa: 11 })
  assert.deepEqual(needsAttention(items).map((x) => x.id), ["mfa"])
})
