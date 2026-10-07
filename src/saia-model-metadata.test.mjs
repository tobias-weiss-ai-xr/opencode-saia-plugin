import assert from "node:assert/strict"
import test from "node:test"
import { buildSaiaModel, buildSaiaModels } from "./saia-model-metadata.js"
import { SAIA_ALIASES } from "./saia-aliases.mjs"

// Shapes taken verbatim from a live GET /v1/models response.
const GLM = { id: "glm-5.3-flash", name: "GLM 5.3 Flash", input: ["text"], output: ["text"], status: "ready" }
const GEMMA = { id: "gemma-4-31b-it", name: "Gemma 4 31B Instruct", input: ["text", "image"], output: ["text"] }
const OMNI = { id: "qwen3-omni-30b-a3b-instruct", name: "Qwen 3 Omni", input: ["text", "image", "audio"], output: ["text"] }
const QWEN35 = { id: "qwen3.5-397b-a17b", name: "Qwen 3.5 397B A17B", input: ["text", "image"], output: ["text", "thought"] }

test("uses SAIA's display name and keeps the tool options", () => {
  const model = buildSaiaModel(GLM)

  assert.equal(model.name, "GLM 5.3 Flash")
  assert.deepEqual(model.options, {
    "enable-tools": true,
    "enable-auto-tool-choice": true,
    "tool-call-parser": "openai",
  })
})

test("marks text-only models as neither attachment nor reasoning", () => {
  const model = buildSaiaModel(GLM)

  assert.equal(model.attachment, undefined)
  assert.equal(model.reasoning, undefined)
})

test("marks image and audio inputs as attachment models", () => {
  assert.equal(buildSaiaModel(GEMMA).attachment, true)
  assert.equal(buildSaiaModel(OMNI).attachment, true)
})

test("marks a thought output as a reasoning model", () => {
  const model = buildSaiaModel(QWEN35)

  assert.equal(model.reasoning, true)
  assert.equal(model.attachment, true)
})

test("never invents context or output limits", () => {
  const model = buildSaiaModel(QWEN35)

  assert.equal(model.limit, undefined, "the API does not report limits, so none may be guessed")
})

test("falls back to the id when SAIA sends no display name", () => {
  assert.equal(buildSaiaModel({ id: "mystery-model" }).name, "mystery-model")
  assert.equal(buildSaiaModel({ id: "mystery-model", name: "" }).name, "mystery-model")
})

test("builds a sorted map of live models plus their aliases, dropping entries without an id", () => {
  const models = buildSaiaModels([QWEN35, GLM, { name: "no id here" }, null])

  assert.deepEqual(Object.keys(models).slice(0, 2), ["glm-5.3-flash", "qwen3.5-397b-a17b"])

  // An alias entry MUST carry `id: <target>`: OpenCode sends the model key
  // upstream otherwise, so the shortcut would answer 404 Model Not Found.
  for (const [alias, target] of Object.entries(SAIA_ALIASES)) {
    const entry = models[alias]
    if (!(target in models)) {
      assert.equal(entry, undefined, `${alias}: registered even though ${target} is absent`)
      continue
    }
    assert.equal(entry.id, target, `${alias} must carry id=${target}`)
    assert.equal(entry.name, `${alias} → ${target}`)
  }
  assert.ok(models["best-for-agentic"], "the glm-5.3-flash alias is missing")
  assert.deepEqual(Object.keys(models).filter((id) => id in SAIA_ALIASES).length, 3)
})

test("tolerates a malformed models payload", () => {
  assert.deepEqual(buildSaiaModels(undefined), {})
  assert.deepEqual(buildSaiaModels({ not: "an array" }), {})
})
