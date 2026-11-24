// Run with: node --test src/components/hub/journey.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { type Can, type Facts, buildJourney, buildPlatformJourney, summarize } from "./journey.ts"

const NONE: Can = { manageMembers: false, manageTargets: false, verifyTargets: false, manageCampaigns: false, generateReports: false, manageOrganizationSecurity: false }
// The permission table of the API, as the five roles have it (FR-1.6)
const ADMIN: Can = { ...NONE, manageMembers: true, manageOrganizationSecurity: true }
const DEVELOPER: Can = { ...NONE, manageTargets: true, verifyTargets: true }
const ANALYST: Can = { ...NONE, manageCampaigns: true, generateReports: true }
const MANAGER: Can = { ...NONE, generateReports: true }

const t = (name: string) => ({ id: name.toLowerCase(), name })
const EMPTY: Omit<Facts, "can"> = { members: 1, openInvitations: 0, targets: { total: 0, unverified: [], verified: [] }, campaignRunFinished: false, awaiting: [] }
const UNVERIFIED: Omit<Facts, "can"> = { ...EMPTY, members: 5, targets: { total: 1, unverified: [t("Support")], verified: [] } }
const VERIFIED: Omit<Facts, "can"> = { ...EMPTY, members: 5, targets: { total: 1, unverified: [], verified: [t("Support")] } }
const RAN: Omit<Facts, "can"> = { ...VERIFIED, campaignRunFinished: true }

const states = (can: Can, facts: Omit<Facts, "can">) => Object.fromEntries(buildJourney({ ...facts, can }).map((task) => [task.id, task.state]))
const ids = (can: Can, facts: Omit<Facts, "can">) => buildJourney({ ...facts, can }).map((task) => task.id)

test("an empty organization: each of the four roles is given a different, honest next step", () => {
  assert.deepEqual(states(ADMIN, EMPTY), { team: "ready", register: "waiting", campaign: "waiting", security: "optional" })
  assert.deepEqual(states(DEVELOPER, EMPTY), { register: "ready", verify: "blocked", campaign: "waiting" })
  assert.deepEqual(states(ANALYST, EMPTY), { register: "waiting", campaign: "blocked" })
  assert.deepEqual(states(MANAGER, EMPTY), { register: "waiting", campaign: "waiting" })
})

test("what a role waits for names the role that has to act, and offers only what it may do", () => {
  const analyst = buildJourney({ ...EMPTY, can: ANALYST }).find((task) => task.id === "register")!
  assert.equal(analyst.who, "AI Application Developer")
  assert.equal(analyst.href, undefined) // an analyst cannot invite: no link to a page that would refuse
  const admin = buildJourney({ ...EMPTY, can: ADMIN }).find((task) => task.id === "register")!
  assert.equal(admin.href, "/admin/members")
})

test("a target that is registered but not verified: the developer acts, the others wait", () => {
  assert.equal(states(DEVELOPER, UNVERIFIED).verify, "ready")
  assert.equal(buildJourney({ ...UNVERIFIED, can: DEVELOPER }).find((x) => x.id === "verify")!.href, "/targets/support/verify")
  assert.equal(states(ANALYST, UNVERIFIED).verify, "waiting")
  assert.equal(states(ANALYST, UNVERIFIED).campaign, "blocked")
  assert.equal(states(MANAGER, UNVERIFIED).verify, "waiting")
})

test("a verified target: the analyst may set up the first campaign, nobody else is told to", () => {
  assert.equal(states(ANALYST, VERIFIED).campaign, "ready")
  assert.match(buildJourney({ ...VERIFIED, can: ANALYST }).find((x) => x.id === "campaign")!.href!, /\/campaigns\/new\?target=support&suite=QUICK-REGRESSION/)
  for (const can of [ADMIN, DEVELOPER, MANAGER]) assert.equal(states(can, VERIFIED).campaign, "waiting")
})

test("an analyst whose campaign awaits approval is told to wait for a manager, never to approve it", () => {
  const facts = { ...VERIFIED, awaiting: [{ code: "C-9", name: "Quick Regression" }] }
  const task = buildJourney({ ...facts, can: ANALYST }).find((x) => x.id === "campaign")!
  assert.equal(task.state, "waiting")
  assert.equal(task.who, "Security Manager")
  assert.doesNotMatch(task.detail + task.action, /approve it|Approve/)
})

test("a step is done only when its outcome exists", () => {
  assert.equal(states(ANALYST, RAN).campaign, "done")
  assert.equal(states(DEVELOPER, VERIFIED).verify, "done")
  assert.equal(states(DEVELOPER, UNVERIFIED).verify, "ready") // visiting the page changes nothing
  assert.equal(states(ADMIN, { ...EMPTY, members: 5 }).team, "done")
})

test("optional steps are shown only when real, and are never counted as setup", () => {
  assert.equal(states(MANAGER, VERIFIED).report, undefined) // nothing has run: no report to offer
  assert.equal(states(MANAGER, RAN).report, "optional")
  const s = summarize(buildJourney({ ...EMPTY, can: ADMIN }))
  assert.deepEqual([s.done, s.total, s.ready, s.quiet], [0, 1, 1, false])
})

test("a finished setup is quiet; the order puts what needs the person first", () => {
  const done = buildJourney({ ...RAN, can: ANALYST })
  assert.equal(summarize(done).quiet, true)
  const order = ids(DEVELOPER, UNVERIFIED)
  assert.equal(order[0], "verify")
})

test("every role always has something to read", () => {
  for (const can of [ADMIN, DEVELOPER, ANALYST, MANAGER]) for (const facts of [EMPTY, UNVERIFIED, VERIFIED, RAN]) assert.ok(buildJourney({ ...facts, can }).length > 0)
})

test("platform: unknown health is not healthy, a saved key is not a tested provider, nothing of an organization is named", () => {
  const unknown = buildPlatformJourney({ health: null, providers: { total: 1, untested: ["Anthropic"] }, organizationsAtLimit: 0 })
  assert.equal(unknown.find((x) => x.id === "health")!.state, "blocked")
  assert.equal(unknown.find((x) => x.id === "providers")!.state, "ready")
  assert.match(unknown.find((x) => x.id === "providers")!.detail, /saved key is not a working connection/)
  const ok = buildPlatformJourney({ health: { status: "operational", openAlerts: 0 }, providers: { total: 2, untested: [] }, organizationsAtLimit: 0 })
  assert.deepEqual(ok.map((x) => x.state), ["done", "done"])
  const alert = buildPlatformJourney({ health: { status: "alert", openAlerts: 2 }, providers: { total: 0, untested: [] }, organizationsAtLimit: 1 })
  assert.deepEqual(alert.map((x) => x.id), ["health", "providers", "limits"])
})

test("after the first run, an analyst with a campaign awaiting approval still only waits for a manager", () => {
  const facts = { ...RAN, awaiting: [{ code: "C-9", name: "Weekly" }] }
  const task = buildJourney({ ...facts, can: ANALYST }).find((x) => x.id === "awaiting")!
  assert.equal(task.state, "waiting")
  assert.equal(task.who, "Security Manager")
  assert.equal(states(MANAGER, facts).awaiting, undefined) // the manager's own queue is "Needs your attention", not a step
  assert.equal(summarize(buildJourney({ ...facts, can: ANALYST })).quiet, false)
})
