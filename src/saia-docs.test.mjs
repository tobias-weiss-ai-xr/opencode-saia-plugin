// Epic SAIA-DOCS — the documentation can never lag the catalog.
//
// User stories covered:
//   US-O1  As a user I want the README model table to list exactly the live
//          models with their real context windows, so I pick from reality.
//   US-O2  As a user I want the documented default model to be the actual
//          default, so copy-pasted commands work.
//   US-O3  As an API consumer I want the documented raw-catalog URL to be
//          correct (https, real path), so one curl gets the facts.

import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { parseContextWindow } from "../scripts/collect-saia-model-info.mjs"

const facts = JSON.parse(readFileSync(new URL("../data/saia-models.json", import.meta.url), "utf8"))
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")

const modelsSection = readme.match(/## Available Models([\s\S]*?)(?=### Model Aliases)/)?.[1] ?? ""

function readmeRows() {
  const rows = new Map()
  for (const [, id, contextDisplay] of modelsSection.matchAll(/^\| `saia\/([^`]+)` \| (\d+K|1M) \|/gm)) {
    rows.set(id, parseContextWindow(contextDisplay))
  }
  return rows
}

test("US-O1: README model table matches the live catalog exactly", () => {
  const rows = readmeRows()
  assert.ok(rows.size > 0, "no model rows found in README")
  const factIds = facts.models.map((model) => model.id)
  assert.deepEqual(
    [...rows.keys()].sort(),
    [...factIds].sort(),
    "README table ids differ from data/saia-models.json",
  )
  for (const model of facts.models) {
    assert.equal(rows.get(model.id), model.context_window.tokens, `${model.id}: README context drifted`)
  }
})

test("US-O2: documented default model is the shipped default", () => {
  const documented = readme.match(/Default model: `([^`]+)`/)?.[1]
  assert.equal(documented, "saia/deepseek-v4-flash-0731")
})

test("US-O3: the raw-catalog curl URL is correct", () => {
  const url = readme.match(/curl -s (https:\/\/\S+saia-models\.json)/)?.[1]
  assert.ok(url, "README must document the https raw catalog URL")
  assert.ok(url.startsWith("https://"), "URL must be https (codeberg 302s http silently)")
})
