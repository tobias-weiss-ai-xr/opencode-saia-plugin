// Epic SAIA-HYGIENE — retired models and hand-curated metadata tables stay
// dead.
//
// User stories covered:
//   US-H1  As a user I want no shipped surface (runtime code, skills, docs)
//          to recommend a model that 500s because SAIA retired it.
//   US-H2  As a maintainer I want the sync scripts to contain no literal
//          context windows or force-include tables — facts come from the
//          collector, taste stays in the taste tables.
//   US-H3  As a maintainer I want every shell entry point to at least parse.

import assert from "node:assert/strict"
import test from "node:test"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const RETIRED_IDS = ["glm-4.7", "qwen3.8-2.4t-a95b", "qwen3.5-122b-a10b", "qwen3.6-27b", "medgemma-27b-it"]

// Everything a user or pi session can read: runtime code, shipped skills,
// user-facing docs. (CHANGELOG is history and exempt.)
const SHIPPED_SURFACES = [
  "opencode.json",
  "src/opencode-saia.json",
  "src/generate-saia-config.sh",
  "README.md",
]

test("US-H1: no shipped surface mentions a retired model", () => {
  for (const path of SHIPPED_SURFACES) {
    const content = readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    for (const id of RETIRED_IDS) {
      assert.ok(!content.includes(id), `${path} still references retired model ${id}`)
    }
  }
})

test("US-H2: sync script carries taste, not facts-as-literals", () => {
  const sync = readFileSync(new URL("../scripts/sync-saia-models.sh", import.meta.url), "utf8")
  assert.ok(!sync.includes("131072"), "sync script hardcodes a context window")
  assert.ok(!sync.includes("FORCE_INCLUDE"), "force-include table resurrected")
  assert.ok(!sync.includes("MODEL_METADATA"), "hand-curated metadata table resurrected")
  assert.ok(sync.includes("fact_for"), "sync script must read facts from the data file")
})

test("US-H3: shell entry points parse", () => {
  for (const script of ["scripts/sync-saia-models.sh", "src/generate-saia-config.sh"]) {
    execFileSync("bash", ["-n", new URL(`../${script}`, import.meta.url).pathname], { stdio: "pipe" })
  }
})
