// Epic SAIA-FACTS (part 2) — the committed facts are internally consistent.
//
// User stories covered:
//   US-F1  As a repo consumer I want data/saia-models.json to satisfy its
//          contract: unique ids, live status, text input, a parsed context
//          window, a decided reasoning flag, and zero collection gaps.
//   US-F2  As a maintainer I want the curated reasoning map to cover every
//          live model (longest-prefix), with vendor sources on every
//          supported entry — a new family must fail here, not in production.
//   US-F3  As a maintainer I want every supported reasoning model to name its
//          vendor API surface (toggle or effort), so integrators know what to
//          send.

import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { reasoningFor } from "../scripts/collect-saia-model-info.mjs"

const facts = JSON.parse(readFileSync(new URL("../data/saia-models.json", import.meta.url), "utf8"))
const reasoningRaw = JSON.parse(readFileSync(new URL("../scripts/reasoning-models.json", import.meta.url), "utf8"))
const entries = reasoningRaw.entries

test("US-F1: data/saia-models.json satisfies the catalog contract", () => {
  assert.ok(facts.models.length > 0, "catalog is empty")
  assert.ok(facts.generated_at, "missing generated_at")
  assert.ok(facts.sources?.live_api && facts.sources?.docs, "missing sources")

  const ids = facts.models.map((model) => model.id)
  assert.equal(new Set(ids).size, ids.length, "duplicate model ids")
  for (const model of facts.models) {
    assert.ok(model.status, `${model.id}: no status`)
    assert.ok(Array.isArray(model.input) && model.input.includes("text"), `${model.id}: must accept text`)
    assert.ok(Array.isArray(model.output) && model.output.length > 0, `${model.id}: no output modalities`)
    assert.ok(
      typeof model.context_window.tokens === "number" && model.context_window.tokens > 0,
      `${model.id}: context window not parsed from docs`,
    )
    assert.notEqual(model.reasoning.supported, null, `${model.id}: reasoning undecidable — curate it`)
  }

  for (const [key, value] of Object.entries(facts.gaps)) {
    assert.deepEqual(value, [], `uncurated gaps in ${key} — run the collector and curate`)
  }
})

test("US-F2: the curated reasoning map covers every live model exactly", () => {
  const prefixes = entries.map((entry) => entry.prefix)
  assert.equal(new Set(prefixes).size, prefixes.length, "duplicate prefixes in reasoning-models.json")

  for (const model of facts.models) {
    const resolved = reasoningFor(model.id, entries)
    assert.equal(resolved.supported, model.reasoning.supported, `${model.id}: data file drifted from the map`)
    if (resolved.supported === true) {
      const entry = entries.find((entry) => model.id === entry.prefix || model.id.startsWith(entry.prefix))
      assert.ok(
        Array.isArray(entry.sources) && entry.sources.length > 0,
        `${model.id}: supported entry must cite vendor sources`,
      )
    }
  }
})

test("US-F3: supported models name their vendor API surface", () => {
  for (const model of facts.models) {
    if (model.reasoning.supported !== true) continue
    assert.ok(
      model.reasoning.toggle || model.reasoning.effort,
      `${model.id}: supported without toggle/effort — how would a client enable it?`,
    )
  }
})
