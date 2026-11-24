import assert from "node:assert/strict"
import test from "node:test"

import { benchmarkReview, runConcerns } from "./benchmark-checks.ts"

const NOW = Date.parse("2026-11-15T12:00:00Z")
const RUN = { status: "running", started_at: "2026-11-15T11:00:00Z", ended_at: null, estimate_minutes: 80, lab_targets: ["RAG chatbot (lab)"] }

test("a running benchmark whose lab target is not ready is not shown as progressing", () => {
  assert.match(runConcerns(RUN, [{ name: "RAG chatbot (lab)", state: "not_ready" }], NOW)[0], /not ready now, so this run cannot be making progress/)
  assert.deepEqual(runConcerns(RUN, [{ name: "RAG chatbot (lab)", state: "ready" }], NOW), [])
  assert.deepEqual(runConcerns(RUN, [{ name: "RAG chatbot (lab)", state: "resetting" }], NOW), [])
})

test("a target the lab does not list at all counts as not ready; an unreadable lab says nothing", () => {
  assert.equal(runConcerns(RUN, [], NOW).length, 1)
  assert.deepEqual(runConcerns(RUN, null, NOW), [])
})

test("far longer than the estimate is said, a normal duration is not", () => {
  const long = { ...RUN, started_at: "2026-11-05T00:00:00Z" }
  assert.match(runConcerns(long, [{ name: "RAG chatbot (lab)", state: "ready" }], NOW)[0], /running for 252 h, far longer than its estimate of about 80 min/)
  assert.deepEqual(runConcerns({ ...RUN, started_at: "2026-11-15T10:00:00Z" }, [{ name: "RAG chatbot (lab)", state: "ready" }], NOW), [])
})

test("only a running benchmark gets concerns", () => {
  assert.deepEqual(runConcerns({ ...RUN, status: "completed" }, [], NOW), [])
  assert.deepEqual(runConcerns({ ...RUN, status: "draft" }, [], NOW), [])
})

test("the review says what is missing, and what each button does, with the estimate labelled as one", () => {
  const empty = benchmarkReview({ readyTargets: [], chosenTargets: [], strategies: [{ key: "A", name: "Static", suites: 0, adaptive: false }, { key: "B", name: "Adaptive", suites: 1, adaptive: true }], budget: 1000, repetitions: 5, judgeEvery: true, estimate: null })
  assert.match(empty.missing.join(" "), /No lab target is ready/)
  assert.match(empty.missing.join(" "), /Static has no test suite/)
  assert.match(empty.lines.join(" "), /Save draft keeps this configuration and runs nothing/)
  assert.match(empty.lines.join(" "), /Save and start begins the first campaign run at once/)
  const ok = benchmarkReview({ readyTargets: ["T"], chosenTargets: ["T"], strategies: [{ key: "A", name: "A", suites: 1, adaptive: false }, { key: "B", name: "B", suites: 1, adaptive: true }], budget: 25, repetitions: 5, judgeEvery: true, estimate: { runs: 10, minutes: 80, attempts: 500, cost: "$12.50–22.50" } })
  assert.deepEqual(ok.missing, [])
  assert.match(ok.lines.join(" "), /Estimate, not a measurement: 10 campaign runs, about 500 attempts, \$12\.50–22\.50/)
})
