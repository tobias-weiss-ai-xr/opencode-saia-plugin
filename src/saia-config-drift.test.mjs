// Epic SAIA-DRIFT — the generated configuration can never drift from the
// collected facts.
//
// User stories covered:
//   US-D1  As an OpenCode user I want every live SAIA model present in
//          opencode.json with the docs-verified context window (never the
//          stale flat 131072), so my agent plans with real limits.
//   US-D2  As an OpenCode user I want aliases to point only at models that
//          exist today, so shortcuts never 404.
//   US-D3  As an OpenCode user I want retired models to stay gone after a
//          sync, so the model picker shows reality.
//   US-D4  As an OpenCode user I want the default model to be installed by
//          the same config that ships it, so a fresh install works.
//   US-D5  As an OpenCode user I want reasoning flags and vendor-recommended
//          sampling to mirror data/saia-models.json, so thinking models are
//          used correctly.
//
// If these tests fail after `scripts/sync-saia-models.sh`, the sync script
// drifted from the collector — never "fix" them by editing fixtures.

import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const config = JSON.parse(readFileSync(new URL("../opencode.json", import.meta.url), "utf8"))
const facts = JSON.parse(readFileSync(new URL("../data/saia-models.json", import.meta.url), "utf8"))
const provider = config.provider.saia
const configured = provider.models
const factById = new Map(facts.models.map((model) => [model.id, model]))

// Retired upstream (HTTP 500 / removed from /v1/models) — must never reappear
// via a stale hand-curated table again. Keep in sync with data/saia-models.json.
const RETIRED_IDS = ["glm-4.7", "qwen3.8-2.4t-a95b", "qwen3.5-122b-a10b", "qwen3.6-27b", "medgemma-27b-it"]

const configuredAliases = Object.entries(configured).filter(([id]) => !factById.has(id))

test("US-D1: every live model is configured with its docs-verified context window", () => {
  assert.ok(facts.models.length > 0)
  for (const model of facts.models) {
    const entry = configured[model.id]
    assert.ok(entry, `${model.id}: live model missing from opencode.json`)
    assert.equal(entry.limit.context, model.context_window.tokens, `${model.id}: context drifted from docs`)
    assert.notEqual(entry.limit.context, 131_072, `${model.id}: suspicious flat 131072 context`)
    assert.equal(
      entry.attachment === true,
      model.input.some((modality) => modality !== "text"),
      `${model.id}: attachment drifted from the live modalities`,
    )
    assert.equal(entry.input, undefined, `${model.id}: config still emits the ignored input array`)
    assert.ok(entry.name.endsWith("(SAIA)"), `${model.id}: display name lost its provider tag`)
  }
})

test("US-D2: every alias resolves to a live model and inherits its limits", () => {
  assert.ok(configuredAliases.length > 0, "aliases vanished from the config")
  for (const [aliasId, alias] of configuredAliases) {
    const targetId = alias.metadata?.alias_of
    assert.ok(targetId, `${aliasId}: alias without alias_of metadata`)
    assert.ok(factById.has(targetId), `${aliasId}: alias points at non-live model ${targetId}`)
    assert.equal(
      alias.id,
      targetId,
      `${aliasId}: missing id=${targetId} — OpenCode sends the alias upstream and SAIA answers 404`,
    )
    const target = configured[targetId]
    assert.equal(alias.limit.context, target.limit.context, `${aliasId}: context mismatch with target`)
    assert.equal(alias.reasoning, target.reasoning, `${aliasId}: reasoning mismatch with target`)
  }
})

test("US-D3: retired models stay gone after sync", () => {
  for (const id of RETIRED_IDS) {
    assert.ok(!configured[id], `${id} is retired upstream but still configured`)
  }
})

test("US-D4: the default model is installed by this very config", () => {
  const defaultId = config.model?.replace(/^saia\//, "")
  assert.ok(defaultId, "no default model set")
  assert.ok(configured[defaultId], `default model ${defaultId} missing from provider models`)
})

test("US-D5: reasoning flags and recommended sampling mirror the facts file", () => {
  for (const model of facts.models) {
    const entry = configured[model.id]
    assert.equal(entry.reasoning, model.reasoning.supported === true, `${model.id}: reasoning flag drifted`)
    if (model.recommended) {
      assert.deepEqual(
        entry.metadata?.recommended,
        model.recommended,
        `${model.id}: vendor-recommended sampling drifted`,
      )
    }
  }
})
