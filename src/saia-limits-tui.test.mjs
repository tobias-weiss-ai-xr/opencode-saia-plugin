import assert from "node:assert/strict"
import test from "node:test"

import { displayLimits, isActiveProvider } from "./saia-limits-tui.tsx"

const saia = { role: "assistant", providerID: "saia", time: { created: 0, completed: 1_000 } }
const other = { role: "assistant", providerID: "kiconnect", time: { created: 0, completed: 2_000 } }

test("formats the remaining limits the server half stored", () => {
  assert.equal(displayLimits({ minute: 8, hour: 1_200 }), "8/m · 1.2k/h")
  assert.equal(displayLimits({ minute: null, hour: "", day: 3, month: 40_000 }), "3/d · 40k/mo")
  assert.equal(displayLimits({}), "")
  assert.equal(displayLimits(null), "")
  assert.equal(displayLimits("nonsense"), "")
})

test("draws only while SAIA is the provider that answered last", () => {
  assert.equal(isActiveProvider([other, saia]), true)
  assert.equal(isActiveProvider([saia, other]), false, "a session that moved to another provider must go quiet")
  assert.equal(isActiveProvider([saia, { role: "user" }]), true, "a user message does not answer anything")
})

test("waits for a turn to complete before handing the display over", () => {
  // An in-flight turn carries no answer yet, so the last completed one still
  // decides. Otherwise the widget would blank the moment a request started.
  assert.equal(isActiveProvider([saia, { role: "assistant", providerID: "kiconnect", time: { created: 9_000 } }]), true)
  assert.equal(isActiveProvider([other, { role: "assistant", providerID: "saia", time: { created: 9_000 } }]), false)
})

test("says no rather than guessing when there is nothing to read", () => {
  assert.equal(isActiveProvider([]), false)
  assert.equal(isActiveProvider(undefined), false)
  assert.equal(isActiveProvider([{ role: "user" }]), false)
  assert.equal(isActiveProvider([{ role: "assistant", time: { completed: 1 } }]), false, "an unlabelled turn is not SAIA's")
})

test("takes the provider id as an argument, so the rule is reusable", () => {
  assert.equal(isActiveProvider([saia, other], "kiconnect"), true)
  assert.equal(isActiveProvider([other, saia], "kiconnect"), false)
})
