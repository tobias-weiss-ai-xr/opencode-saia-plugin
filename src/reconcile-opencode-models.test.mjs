import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, test } from "bun:test"
import { reconcileConfig, pruneStaleModels } from "./reconcile-opencode-models.mjs"

const LIVE = ["glm-5.3", "deepseek-v4-flash", "local/deepseek-v4-flash/ai1", "meta-llama/llama-4-maverick"]

function configWith(overrides = {}) {
  return {
    provider: {
      litellm: {
        options: { baseURL: "http://127.0.0.1:4000/v1", apiKey: "{env:LITELLM_API_KEY}" },
        models: {
          "glm-5.3": { name: "GLM 5.3" },
          "deepseek-v4-flash": { name: "DeepSeek V4 Flash" },
          "stale-old-model": { name: "Dead model" },
        },
      },
      ...overrides,
    },
  }
}

function okFetch(liveIds) {
  return async () => ({ ok: true, json: async () => ({ data: liveIds.map((id) => ({ id })) }) })
}

describe("reconcileConfig", () => {
  test("prunes stale model keys and keeps live ones", async () => {
    const config = configWith()
    const { report } = await reconcileConfig(config, { fetchImpl: okFetch(LIVE), env: {} })

    assert.deepEqual(Object.keys(config.provider.litellm.models), ["glm-5.3", "deepseek-v4-flash"])
    assert.deepEqual(report.removed.litellm, ["stale-old-model"])
  })

  test("keeps favorites that match a live id by suffix (openrouter style)", async () => {
    const config = configWith({
      openrouter: {
        options: { baseURL: "https://openrouter.ai/api/v1" },
        models: { "llama-4-maverick": { name: "Ma" }, "gone-forever": { name: "G" } },
      },
    })
    const { report } = await reconcileConfig(config, { fetchImpl: okFetch(LIVE), env: {} })

    assert.deepEqual(Object.keys(config.provider.openrouter.models), ["llama-4-maverick"])
    assert.deepEqual(report.removed.openrouter, ["gone-forever"])
  })

  test("skips a provider whose /v1/models is unreachable, leaving config untouched", async () => {
    const config = configWith()
    const warnings = []
    const { report } = await reconcileConfig(config, {
      fetchImpl: async () => { throw new Error("ECONNREFUSED") },
      env: {},
      onWarning: (m) => warnings.push(m),
    })

    assert.equal(Object.keys(config.provider.litellm.models).length, 3)
    assert.deepEqual(report.removed, {})
    assert.deepEqual(report.skipped, ["litellm"])
    assert.match(warnings[0], /Skipping litellm: .*ECONNREFUSED/)
  })

  test("skips a provider on a non-2xx model response", async () => {
    const config = configWith()
    const { report } = await reconcileConfig(config, {
      fetchImpl: async () => ({ ok: false, status: 401 }),
      env: {},
    })
    assert.deepEqual(report.skipped, ["litellm"])
    assert.deepEqual(Object.keys(config.provider.litellm.models).length, 3)
  })

  test("resolves {env:KEY} api keys from the supplied environment", async () => {
    const seen = []
    const config = configWith()
    await reconcileConfig(config, {
      fetchImpl: async (_url, init = {}) => {
        seen.push(init.headers["Authorization"])
        return { ok: true, json: async () => ({ data: [{ id: "glm-5.3" }] }) }
      },
      env: { LITELLM_API_KEY: "sk-live" },
    })
    assert.deepEqual(seen, ["Bearer sk-live"])
  })

  test("ignores providers without a baseURL or models", async () => {
    const config = {
      provider: {
        google: { options: { apiKey: "{env:GOOGLE_API_KEY}" }, models: { "gemini-2.5-flash": {} } },
        empty: { options: { baseURL: "x" } },
      },
    }
    const { report } = await reconcileConfig(config, { fetchImpl: okFetch(LIVE), env: {} })
    assert.deepEqual(report.removed, {})
    assert.deepEqual(Object.keys(config.provider.google.models), ["gemini-2.5-flash"])
  })

  test("handles a missing or empty provider block gracefully", async () => {
    const { report } = await reconcileConfig({}, { fetchImpl: okFetch(LIVE), env: {} })
    assert.deepEqual(report.removed, {})
    assert.deepEqual(report.skipped, [])
  })
})

describe("pruneStaleModels", () => {
  test("returns ids that are neither live nor a trailing /id segment", () => {
    const removed = pruneStaleModels(
      ["glm-5.3", "deepseek-v4-flash", "meta-llama/llama-4-maverick"],
      ["deepseek-v4-flash", "llama-4-maverick", "stale-old-model"],
    )
    assert.deepEqual(removed, ["stale-old-model"])
  })
})

describe("CLI", () => {
  test("--dry-run reports without writing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "saia-reconcile-"))
    try {
      const file = path.join(dir, "opencode.json")
      const original = JSON.stringify(configWith(), null, 2)
      await writeFile(file, original)

      const lines = []
      const code = await (await import("./reconcile-opencode-models.mjs")).main(
        ["node", "reconcile", "--dry-run", file],
        { log: (m) => lines.push(m), error: () => {} },
      )

      assert.equal(code, 0)
      assert.equal(await readFile(file, "utf8"), original)
      assert.ok(lines.some((l) => /litellm: removed 1 stale/.test(l)))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("writes backup and pruned config without --dry-run", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "saia-reconcile-"))
    try {
      const file = path.join(dir, "opencode.json")
      await writeFile(file, JSON.stringify(configWith()))

      const { main } = await import("./reconcile-opencode-models.mjs")
      const code = await main(["node", "reconcile", file], { log: () => {}, error: () => {} })

      assert.equal(code, 0)
      const written = JSON.parse(await readFile(file, "utf8"))
      assert.deepEqual(Object.keys(written.provider.litellm.models), ["glm-5.3", "deepseek-v4-flash"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
