// Epic SAIA-WIRE — what OpenCode sends to SAIA has to be what SAIA serves, and
// every surface that describes the models has to agree with the config that ships.
//
// User stories covered:
//   US-W1  As an OpenCode user I want every alias to declare the upstream model id
//          (`id: <target>`), so a shortcut is not an opaque 404. OpenCode sends the
//          model key unless the entry overrides it.
//   US-W2  As a maintainer I want one alias map shared by the plugin, the generated
//          config and the sync script, so the three cannot disagree again.
//   US-W3  As a user I want no surface to emit a field OpenCode ignores
//          (`input`, `can_reason`), because those silently disabled vision and
//          reasoning instead of failing loudly.
//   US-W4  As a user I want the README table to mirror the shipped config —
//          context, output limit and attachment capability.
//   US-W5  As a user I want no shipped code path to name a model SAIA retired, so
//          a fresh install never recommends a 404.
//
// If a test here fails after `scripts/sync-saia-models.sh`, the generator drifted
// from data/saia-models.json — never "fix" it by editing the fixture.

import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

import { SAIA_ALIASES } from "./saia-aliases.mjs"
import { buildSaiaModels } from "./saia-model-metadata.js"

const ROOT = new URL("../", import.meta.url)
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8")

const config = JSON.parse(read("opencode.json"))
const configured = config.provider.saia.models
const facts = JSON.parse(read("data/saia-models.json"))
const factIds = new Set(facts.models.map((model) => model.id))
const configuredAliasIds = Object.keys(configured).filter((id) => !factIds.has(id))

// Retired upstream (removed from /v1/models): naming one in shipped code is how a
// fresh install ends up recommending a model that answers 404.
const RETIRED_IDS = ["glm-4.7", "qwen3.8-2.4t-a95b", "qwen3.5-122b-a10b", "qwen3.6-27b", "medgemma-27b-it"]

const SHIPPED_CODE = [
  "src/saia.ts",
  "src/saia-v2.mjs",
  "src/saia-config.mjs",
  "src/saia-model-metadata.js",
  "src/saia-memory.ts",
  "src/saia-aliases.mjs",
  "src/generate-saia-config.sh",
  "scripts/sync-saia-models.sh",
]

test("US-W1: every alias declares the upstream model id OpenCode must send", () => {
  assert.equal(configuredAliasIds.length, Object.keys(SAIA_ALIASES).length, "alias surface drifted")
  for (const aliasId of configuredAliasIds) {
    const entry = configured[aliasId]
    assert.equal(entry.id, SAIA_ALIASES[aliasId], `${aliasId}: id must be its target`)
    assert.ok(factIds.has(entry.id), `${aliasId}: target ${entry.id} is not a live model`)
    // An alias must not advertise capabilities its target does not have.
    const target = configured[entry.id]
    assert.equal(entry.limit.context, target.limit.context, `${aliasId}: context != target`)
    assert.equal(entry.limit.output, target.limit.output, `${aliasId}: output != target`)
  }
})

test("US-W2: the plugin, the generated config and the sync script share one alias map", () => {
  // The plugin projects the same map over whatever the API returned today.
  const built = buildSaiaModels(facts.models)
  const pluginAliases = Object.keys(built).filter((id) => id in SAIA_ALIASES)
  assert.deepEqual(
    pluginAliases.sort(),
    configuredAliasIds.sort(),
    "the plugin and opencode.json disagree about which aliases exist",
  )
  for (const aliasId of pluginAliases) {
    assert.equal(built[aliasId].id, SAIA_ALIASES[aliasId], `${aliasId}: plugin lost its id override`)
  }

  // The sync script must read the map, not keep a second copy of it.
  const sync = read("scripts/sync-saia-models.sh")
  assert.match(sync, /saia-aliases\.mjs/, "sync script must read the shared alias map")
  const hardcoded = [...sync.matchAll(/"([a-z-]+)\|([a-z0-9.\-]+)"/g)].map((m) => m[1])
  assert.deepEqual(hardcoded, [], `sync script still hardcodes aliases: ${hardcoded.join(", ")}`)
})

test("US-W3: no surface emits a field OpenCode ignores", () => {
  for (const [id, entry] of Object.entries(configured)) {
    assert.equal(entry.input, undefined, `${id}: "input" is ignored — use "attachment"`)
    assert.equal(entry.can_reason, undefined, `${id}: "can_reason" is ignored — use "reasoning"`)
    assert.equal(typeof entry.attachment, "boolean", `${id}: attachment must be declared explicitly`)
    assert.equal(typeof entry.reasoning, "boolean", `${id}: reasoning must be declared explicitly`)
  }
  // The older hand-maintained generator must emit the real field names too.
  const generator = read("src/generate-saia-config.sh")
  assert.ok(!generator.includes('"can_reason": true'), "generate-saia-config.sh still emits can_reason")
})

test("US-W4: the README table mirrors the shipped config", () => {
  const readme = read("README.md")
  const rows = new Map(
    [...readme.matchAll(/^\| `saia\/([^`]+)` \| ([\d.]+[KM]) \| ([\d.]+[KM]) \|/gm)].map((m) => [
      m[1],
      { context: m[2], output: m[3] },
    ]),
  )
  assert.ok(rows.size > 0, "no model rows found in README")

  // The table renders context in decimal K (256000 -> 256K) and output limits in
  // binary K (32768 -> 32K), which is how the config values are chosen.
  const context = (tokens) => (tokens % 1_000_000 === 0 ? `${tokens / 1_000_000}M` : `${tokens / 1000}K`)
  const output = (tokens) => `${tokens / 1024}K`

  for (const model of facts.models) {
    const row = rows.get(model.id)
    assert.ok(row, `${model.id}: missing from the README table`)
    assert.equal(row.context, context(model.context_window.tokens), `${model.id}: documented context`)
    assert.equal(row.output, output(configured[model.id].limit.output), `${model.id}: documented output`)
  }
})

test("US-W5: shipped code names no retired model", () => {
  for (const rel of SHIPPED_CODE) {
    const text = read(rel)
    for (const retired of RETIRED_IDS) {
      assert.ok(!text.includes(retired), `${rel} still names the retired model ${retired}`)
    }
  }
})
