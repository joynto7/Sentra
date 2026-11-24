import assert from "node:assert/strict"
import test from "node:test"

import { integrationDraftKey, keyDraftIsEmpty, sanitizeKeyDraft, sanitizeWebhookDraft, webhookDraftIsEmpty } from "./integration-drafts.ts"

test("a key draft keeps only the allow-listed non-secret fields, even when more was stored", () => {
  const d = sanitizeKeyDraft({ name: "Release", purpose: "CI", scopes: ["read_findings"], target_ids: ["t1"], expires: "2027-01-01", password: "hunter2", key: "sk_live_x", token: "abc" })!
  assert.deepEqual(Object.keys(d).sort(), ["expires", "name", "purpose", "scopes", "target_ids"])
  assert.doesNotMatch(JSON.stringify(d), /hunter2|sk_live|abc/)
})

test("a webhook draft keeps the name and the events, never the address or a secret", () => {
  const d = sanitizeWebhookDraft({ name: "Jira", events: ["finding.confirmed"], url: "https://x.example/hook?token=SECRET", secret: "whsec_1" })!
  assert.deepEqual(Object.keys(d).sort(), ["events", "name"])
  assert.doesNotMatch(JSON.stringify(d), /SECRET|whsec|https/)
})

test("wrong shapes are dropped instead of trusted", () => {
  assert.equal(sanitizeKeyDraft("x"), null)
  assert.equal(sanitizeWebhookDraft(null), null)
  assert.deepEqual(sanitizeKeyDraft({ name: 5, scopes: "all", target_ids: [1, "a"] }), { name: "", purpose: "", scopes: [], target_ids: ["a"], expires: "" })
})

test("the draft key holds the kind, the user and the organization", () => {
  assert.equal(integrationDraftKey("api-key", "u1", "o1"), "sentra:integration-draft:v1:api-key:u1:o1")
  assert.notEqual(integrationDraftKey("webhook", "u1", "o1"), integrationDraftKey("api-key", "u1", "o1"))
  assert.notEqual(integrationDraftKey("webhook", "u1", "o1"), integrationDraftKey("webhook", "u1", "o2"))
})

test("an untouched dialog has no draft worth keeping", () => {
  assert.equal(keyDraftIsEmpty({ name: " ", purpose: "", scopes: [], target_ids: [], expires: "2027-01-01" }), true)
  assert.equal(webhookDraftIsEmpty({ name: "", events: ["a"] }), false)
})
