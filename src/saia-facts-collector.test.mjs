// Epic SAIA-FACTS — the collector produces correct facts.
//
// User stories covered:
//   US-C1  As a repo consumer I want docs context displays ("65k", "1M",
//          "1.05M") parsed into exact token numbers, so limits are real.
//   US-C2  As a repo consumer I want recommended sampling parsed into
//          {temperature, top_p} when present and absent otherwise.
//   US-C3  As a repo consumer I want docs display names matched to API ids
//          (including "Instruct" suffix drift), with external/closed models
//          never matched.
//   US-C4  As a repo consumer I want reasoning entries resolved by longest
//          prefix, with unknown families reported as {supported: null}.
//   US-C5  As a repo consumer I want the full merge to record the provenance
//          of every gap (api_without_docs, docs_without_api,
//          reasoning_unknown) instead of guessing.
//
// Ground-truth fixtures below are minimal shapes of the real sources
// (live /v1/models entries and the GWDG docs tables).

import assert from "node:assert/strict"
import test from "node:test"
import {
  parseContextWindow,
  parseRecommended,
  nameAliases,
  matchDocsRow,
  reasoningFor,
  buildCatalog,
} from "../scripts/collect-saia-model-info.mjs"

test("US-C1: context window display values parse to exact token counts", () => {
  assert.equal(parseContextWindow("1M"), 1_000_000)
  assert.equal(parseContextWindow("256K"), 256_000)
  assert.equal(parseContextWindow("65k"), 65_000)
  assert.equal(parseContextWindow("1.05M"), 1_050_000)
  assert.equal(parseContextWindow("4096"), 4096)
  assert.equal(parseContextWindow("1,048,576"), 1_048_576)
  assert.equal(parseContextWindow("n/a"), null)
  assert.equal(parseContextWindow(""), null)
  assert.equal(parseContextWindow("1M tokens"), null)
})

test("US-C2: recommended sampling parses temp/top_p and tolerates garbage", () => {
  assert.deepEqual(parseRecommended("temp=0.8, top_p=0.9"), { temperature: 0.8, top_p: 0.9 })
  assert.deepEqual(parseRecommended("temperature=1"), { temperature: 1 })
  assert.deepEqual(parseRecommended("Top_P=0.95"), { top_p: 0.95 })
  assert.equal(parseRecommended("-"), undefined)
  assert.equal(parseRecommended("see vendor docs"), undefined)
})

test("US-C3: docs names match API ids including Instruct-suffix drift", () => {
  assert.deepEqual(nameAliases("Gemma 4 31B Instruct"), ["gemma431binstruct", "gemma431b"])
  assert.deepEqual(nameAliases("GLM 5.3 Flash"), ["glm53flash"])

  const rows = [
    { name: "GLM 5.3 Flash", external: false },
    { name: "Gemma 4 31B Instruct", external: false },
    { name: "GPT-5 (closed)", external: true },
  ]
  assert.equal(matchDocsRow("gemma-4-31b-it", rows).name, "Gemma 4 31B Instruct")
  assert.equal(matchDocsRow("glm-5.3-flash", rows).name, "GLM 5.3 Flash")
  // external (closed) models are never matched, even by name
  assert.equal(matchDocsRow("gpt-5", rows), undefined)
})

test("US-C4: reasoning entries resolve by longest prefix, unknown → null", () => {
  const entries = [
    { prefix: "qwen3-", supported: false },
    { prefix: "qwen3.5-", supported: true, toggle: { enable_thinking: "bool" } },
    { prefix: "glm-5.3", supported: true, effort: { reasoning_effort: ["low", "high", "max"] } },
  ]
  assert.deepEqual(reasoningFor("qwen3.5-397b-a17b", entries), {
    supported: true,
    toggle: { enable_thinking: "bool" },
  })
  assert.deepEqual(reasoningFor("qwen3-30b-a3b-instruct-2507", entries), { supported: false })
  assert.deepEqual(reasoningFor("glm-5.3-flash", entries), {
    supported: true,
    effort: { reasoning_effort: ["low", "high", "max"] },
  })
  assert.deepEqual(reasoningFor("totally-new-model", entries), { supported: null })
})

test("US-C5: buildCatalog merges all three sources and reports every gap honestly", () => {
  const liveModels = [
    { id: "brand-new-model", name: "Brand New", input: ["text"], output: ["text"], status: "ready" },
    { id: "glm-5.3-flash", name: "glm-5.3-flash", input: ["text"], output: ["text"], status: "ready" },
  ]
  const docsHtml = `
    <table>
      <tr><th>Organization</th><th>Model</th><th>Open</th><th>Release date</th><th>Context window</th><th>Advantages</th><th>Limitations</th><th>Recommended settings</th></tr>
      <tr><td>Z.ai</td><td>GLM 5.3 Flash</td><td>Yes</td><td>2026-06</td><td>1M</td><td>fast</td><td>none</td><td>temp=1, top_p=0.95</td></tr>
      <tr><td>OpenAI</td><td>GPT-5 (closed)</td><td>No</td><td>2026-01</td><td>400K</td><td>-</td><td>-</td><td>-</td></tr>
      <tr><td>SAP</td><td>E5 Embeddings</td><td>Yes</td><td>2025-01</td><td>8K</td><td>embedding model</td><td>-</td><td>-</td></tr>
      <tr><td>DeepSeek</td><td>DeepSeek V4 Flash</td><td>Yes</td><td>2026-07</td><td>1M</td><td>-</td><td>-</td><td>temp=0.0</td></tr>
    </table>`
  const { models, gaps } = buildCatalog({
    liveModels,
    docsHtml,
    reasoningEntries: [{ prefix: "glm-5.3", supported: true }],
  })

  // sorted by id
  assert.deepEqual(models.map((model) => model.id), ["brand-new-model", "glm-5.3-flash"])
  const [fresh, glm] = models

  // merged docs facts
  assert.equal(glm.name, "GLM 5.3 Flash")
  assert.equal(glm.org, "Z.ai")
  assert.deepEqual(glm.context_window, { display: "1M", tokens: 1_000_000 })
  assert.deepEqual(glm.recommended, { temperature: 1, top_p: 0.95 })
  assert.equal(glm.reasoning.supported, true)

  // model without docs facts: fields null, not guessed
  assert.deepEqual(fresh.context_window, { display: null, tokens: null })
  assert.equal(fresh.reasoning.supported, null)

  // gaps: api model without docs row, reasoning unknown for the fresh model
  assert.deepEqual(gaps.api_without_docs, ["brand-new-model"])
  assert.deepEqual(gaps.reasoning_unknown, ["brand-new-model"])
  // docs_without_api excludes the closed model, the embeddings row and matched rows
  assert.deepEqual(gaps.docs_without_api, ["DeepSeek V4 Flash"])
})
