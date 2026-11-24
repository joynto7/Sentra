import assert from "node:assert/strict"
import test from "node:test"

import type { Definition } from "@/lib/test-library"

import { definitionChanges, suiteChange, suiteSaveImpact } from "./authoring-changes.ts"

const DEF = { name: "A", category: "LLM01", severity: "high", objective: "o", prerequisites: "", target_types: ["chatbot"], success_condition: "s", detection_methods: [], success_rules: [], attempt_template: "t", recommended_mitigation: "m", atlas: [] } as unknown as Definition

test("a suite's added and removed tests are named against the current version; a new suite adds all", () => {
  assert.deepEqual(suiteChange(["A", "B"], ["B", "C"]), { added: ["C"], removed: ["A"] })
  assert.deepEqual(suiteChange(null, ["A"]), { added: ["A"], removed: [] })
})

test("the changed fields of a definition are named in the form's words, and none when equal", () => {
  assert.deepEqual(definitionChanges(DEF, DEF), [])
  assert.deepEqual(definitionChanges(DEF, { ...DEF, objective: "x", target_types: ["chatbot", "rag"] }), ["objective", "applicable target types"])
})

test("saving an edited suite names the version, the history, the changes and the campaigns", () => {
  const t = suiteSaveImpact({ editing: true, name: "Q", nextVersion: 3, count: 5, retired: 1, added: ["T-1"], removed: ["T-2"], campaigns: 2 }).join(" ")
  assert.match(t, /Saves version 3 of “Q” with 5 tests\. Version 2 stays in the history/)
  assert.match(t, /Added: T-1\. Removed: T-2\./)
  assert.match(t, /2 campaigns use this suite and will run version 3 from the next run; earlier runs keep the version they used/)
  assert.match(t, /always runs their current versions/)
  assert.match(t, /1 retired test is skipped/)
})

test("a new suite is version 1 and used by nothing yet", () => {
  const t = suiteSaveImpact({ editing: false, name: "", nextVersion: 1, count: 1, retired: 0, added: ["A"], removed: [], campaigns: 0 }).join(" ")
  assert.match(t, /as version 1 with 1 test\. No campaign uses it until one chooses it/)
})
