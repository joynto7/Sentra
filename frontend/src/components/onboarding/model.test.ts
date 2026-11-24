import assert from "node:assert/strict"
import test from "node:test"

import { type Can, defaultTask, destination, resumeAt, stepsFor, tasksFor } from "./model.ts"

const NONE: Can = { manageTargets: false, lab: false, campaigns: false, approve: false, members: false }
const DEVELOPER: Can = { ...NONE, manageTargets: true }
const ANALYST: Can = { ...NONE, lab: true, campaigns: true }
const MANAGER: Can = { ...NONE, approve: true }
const ADMIN: Can = { ...NONE, members: true }

test("only people who may invite get the team step", () => {
  assert.deepEqual(stepsFor(ADMIN), ["goal", "task", "team", "done"])
  assert.deepEqual(stepsFor(ANALYST), ["goal", "task", "done"])
})

test("a person is offered only tasks their role may do, and can always look around", () => {
  assert.deepEqual(tasksFor(DEVELOPER).map((t) => t.id), ["register_target", "explore"])
  assert.deepEqual(tasksFor(ANALYST).map((t) => t.id), ["lab", "campaign", "explore"])
  assert.deepEqual(tasksFor(MANAGER).map((t) => t.id), ["review", "explore"])
  assert.deepEqual(tasksFor(NONE).map((t) => t.id), ["explore"])
})

test("the default follows the goal when the role allows it, and falls back to what it does allow", () => {
  assert.equal(defaultTask("own_app", tasksFor(DEVELOPER)), "register_target")
  assert.equal(defaultTask("learn", tasksFor(ANALYST)), "lab")
  assert.equal(defaultTask("company", tasksFor(ANALYST)), "campaign")
  assert.equal(defaultTask("learn", tasksFor(DEVELOPER)), "register_target")
  assert.equal(defaultTask("own_app", tasksFor(MANAGER)), "review")
  assert.equal(defaultTask(undefined, tasksFor(NONE)), "explore")
})

test("a task the role no longer allows leads to the dashboard, never to a page that would refuse", () => {
  assert.equal(destination("lab", tasksFor(ANALYST)), "/lab")
  assert.equal(destination("lab", tasksFor(DEVELOPER)), "/dashboard")
  assert.equal(destination(undefined, tasksFor(ANALYST)), "/dashboard")
})

test("coming back opens where the person stopped, within the steps they have", () => {
  assert.equal(resumeAt(2, stepsFor(ADMIN)), 2)
  assert.equal(resumeAt(3, stepsFor(ANALYST)), 2)
  assert.equal(resumeAt(-1, stepsFor(ANALYST)), 0)
})
