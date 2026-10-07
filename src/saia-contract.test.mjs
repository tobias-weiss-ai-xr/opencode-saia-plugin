// Epic SAIA-CONTRACT — the data file's own structure is consistent.
//
// User stories covered:
//   US-T1  As a repo consumer I want models[] to be derived from the recorded
//          live API snapshot (same ids, same modalities), so the catalog
//          cannot claim models the API never returned.
//   US-T2  As a repo consumer I want provenance fields (generated_at, source
//          URLs) present and well-formed, so staleness is detectable.

import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const facts = JSON.parse(readFileSync(new URL("../data/saia-models.json", import.meta.url), "utf8"))

test("US-T1: models[] is derived from the recorded live snapshot", () => {
  const snapshotIds = facts.live.models.map((model) => model.id).sort()
  const catalogIds = facts.models.map((model) => model.id).sort()
  assert.deepEqual(catalogIds, snapshotIds, "catalog ids differ from the live snapshot")

  const snapshotById = new Map(facts.live.models.map((model) => [model.id, model]))
  for (const model of facts.models) {
    const snapshot = snapshotById.get(model.id)
    assert.deepEqual(model.input, snapshot.input ?? ["text"], `${model.id}: input drifted from snapshot`)
    assert.deepEqual(model.output, snapshot.output ?? ["text"], `${model.id}: output drifted from snapshot`)
  }
})

test("US-T2: provenance fields are present and well-formed", () => {
  assert.ok(!Number.isNaN(Date.parse(facts.generated_at)), "generated_at is not a date")
  for (const [key, url] of Object.entries(facts.sources)) {
    if (key === "notes" || key === "reasoning") continue
    assert.ok(String(url).startsWith("https://"), `sources.${key} must be an https URL`)
  }
})
