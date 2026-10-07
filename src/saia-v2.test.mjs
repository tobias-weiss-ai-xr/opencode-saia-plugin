import assert from "node:assert/strict"
import test from "node:test"
import { createSaiaV2Setup } from "./saia.ts"
import {
  DEFAULT_SAIA_MODEL,
  decorateSaiaV2Provider,
  saiaModelInfoFromApiModel,
  saiaProviderInfo,
  shouldReplaceDefaultModel,
  v2ProviderPackage,
} from "./saia-v2.mjs"

const DEEPSEEK = {
  id: "deepseek-v4-flash-0731",
  name: "DeepSeek V4 Flash",
  input: ["text"],
  output: ["text"],
  status: "ready",
}

const READY_MODELS = [
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", input: ["text"], output: ["text"], status: "ready" },
  {
    id: "qwen3.6-35b-a3b",
    name: "Qwen 3.6 35B A3B",
    input: ["text", "image"],
    output: ["text", "thought"],
    status: "ready",
  },
]

test("maps SAIA API models onto v2 Model.Info", () => {
  const [glm, qwen] = READY_MODELS.map(saiaModelInfoFromApiModel)

  assert.deepEqual(glm.capabilities, { tools: true, input: ["text"], output: ["text"] })
  assert.equal(glm.providerID, "saia")
  assert.equal(glm.modelID, "glm-5.3-flash")
  assert.equal(glm.name, "GLM 5.3 Flash")
  assert.deepEqual(glm.limit, { context: 0, output: 0 })
  assert.equal(glm.settings["tool-call-parser"], "openai")

  assert.deepEqual(qwen.capabilities.input, ["text", "image"])
  assert.ok(qwen.capabilities.output.includes("thought"))
})

test("overlays curated inventory and drops stale plugin-managed models", () => {
  const generated = decorateSaiaV2Provider({
    models: [READY_MODELS[0], DEEPSEEK],
    managedModels: {
      "glm-5.3-flash": saiaModelInfoFromApiModel(READY_MODELS[0]),
      stale: { ...saiaModelInfoFromApiModel({ id: "stale", name: "Stale" }) },
    },
    existingModels: [
      { ...saiaModelInfoFromApiModel(READY_MODELS[0]), limit: { context: 200000, output: 8192 } },
      saiaModelInfoFromApiModel({ id: "stale", name: "Stale" }),
      { ...saiaModelInfoFromApiModel({ id: "custom-stale", name: "Custom" }), limit: { context: 123 } },
      { ...saiaModelInfoFromApiModel({ id: "my-alias", name: "User alias" }) },
    ],
  })

  assert.deepEqual(
    generated.modelIDs,
    [
      "best-for-agentic",
      "budget",
      "custom-stale",
      "deepseek-v4-flash-0731",
      "glm-5.3-flash",
      "my-alias",
    ],
  )
  // An alias resolves to its target's model id on the wire.
  assert.equal(generated.models.find((m) => m.id === "best-for-agentic").modelID, "glm-5.3-flash")
  assert.deepEqual(
    generated.models.find((model) => model.id === "glm-5.3-flash").limit,
    { context: 200000, output: 8192 },
  )
  assert.equal(generated.selected, DEFAULT_SAIA_MODEL)
  // The next snapshot no longer contains "stale".
  assert.equal(generated.managedModels.stale, undefined)
})

test("keeps the user-preferred model when it is available", () => {
  const { selected } = decorateSaiaV2Provider({
    models: READY_MODELS,
    preferredModel: "qwen3.6-35b-a3b",
  })

  assert.equal(selected, "qwen3.6-35b-a3b")
})

test("falls back to the first model when the preferred default is gone", () => {
  const { selected } = decorateSaiaV2Provider({
    models: [READY_MODELS[1]],
    preferredModel: DEFAULT_SAIA_MODEL,
  })

  assert.equal(selected, "qwen3.6-35b-a3b")
})

test("builds a fallback provider and maps transports to v2 packages", () => {
  const info = saiaProviderInfo({ package: v2ProviderPackage({ id: "chat-completions" }), apiKey: "key" })

  assert.equal(info.id, "saia")
  assert.equal(info.package, "@opencode/ai/providers/openai-compatible")
  assert.equal(info.settings.baseURL, "https://chat-ai.academiccloud.de/v1")
  assert.equal(info.settings.apiKey, "key")
  assert.equal(v2ProviderPackage({ id: "responses" }), "@opencode/ai/providers/openai")
  assert.equal(
    saiaProviderInfo({ package: v2ProviderPackage({ id: "responses" }) }).settings.apiKey,
    undefined,
  )
})

test("repairs only unavailable SAIA defaults", () => {
  assert.equal(shouldReplaceDefaultModel(undefined, ["glm-5.3-flash"]), true)
  assert.equal(
    shouldReplaceDefaultModel({ providerID: "saia", modelID: "glm-4.7" }, ["glm-5.3-flash"]),
    true,
  )
  assert.equal(
    shouldReplaceDefaultModel({ providerID: "saia", modelID: "glm-5.3-flash" }, ["glm-5.3-flash"]),
    false,
  )
  assert.equal(
    shouldReplaceDefaultModel({ providerID: "anthropic", modelID: "claude" }, ["glm-5.3-flash"]),
    false,
  )
})

function createV2Harness({
  models = READY_MODELS,
  settings = {},
  existingModels = [],
  defaultModel,
  apiKey = "test-key",
} = {}) {
  const calls = { hooks: [], defaultSet: undefined, modelsSet: undefined, added: undefined, sessionUpdates: [] }
  const sessions = new Map()
  let savedSettings

  const saiaProvider = {
    id: "saia",
    package: "@opencode/ai/providers/openai-compatible",
    settings: { baseURL: "https://chat-ai.academiccloud.de/v1", apiKey: "{env:SAIA_API_KEY}" },
  }

  const editor = {
    get: (id) =>
      id === "saia"
        ? { provider: saiaProvider, models: new Map(existingModels.map((model) => [model.id, model])) }
        : undefined,
    models: {
      set: (providerID, models) => {
        calls.modelsSet = { providerID, models }
      },
    },
    update: (providerID, update) => {
      assert.equal(providerID, "saia")
      update(saiaProvider)
    },
    add: (input) => {
      calls.added = input
    },
  }

  const ctx = {
    provider: { transform: async (update) => update(editor) },
    model: {
      transform: async (update) =>
        update({
          default: {
            get: () => defaultModel,
            set: (providerID, modelID) => {
              calls.defaultSet = { providerID, modelID }
            },
          },
        }),
    },
    session: {
      async hook(name, callback, options) {
        calls.hooks.push({ name, callback, options })
      },
      async get({ sessionID }) {
        return { metadata: { ...sessions.get(sessionID) } }
      },
      async update(input) {
        calls.sessionUpdates.push(input)
        sessions.set(input.sessionID, input.metadata)
      },
    },
  }

  const setup = createSaiaV2Setup({
    async fetch() {
      return new Response(JSON.stringify({ data: models }), { status: 200 })
    },
    async resolveApiKey() {
      return apiKey
    },
    async resolveTransport() {
      return { id: "chat-completions", npm: "@ai-sdk/openai-compatible" }
    },
    async readSettings() {
      return settings
    },
    async updateSettings(update) {
      savedSettings = await update(settings)
    },
    async fetchWithCache(fetcher) {
      return { data: await fetcher(), cached: false }
    },
    async getContext() {
      return {}
    },
    async getPreferences() {
      return {}
    },
    async updateMetrics() {},
    onWarning() {},
  })

  return { calls, ctx, setup, savedSettings: () => savedSettings }
}

test("v2 setup registers hooks, replaces the inventory, and injects the API key", async () => {
  const existing = [{ ...saiaModelInfoFromApiModel(READY_MODELS[0]), limit: { context: 200000, output: 8192 } }]
  const harness = createV2Harness({ existingModels: existing, settings: { transport: "chat-completions" } })

  await harness.setup(harness.ctx)

  // Limits + system-part hooks are registered even before models load.
  assert.equal(harness.calls.hooks[0].name, "http.response")
  assert.deepEqual(harness.calls.hooks[0].options, { providerID: "saia" })
  assert.equal(harness.calls.hooks[1].name, "context")

  assert.equal(harness.calls.added, undefined)
  assert.equal(harness.calls.modelsSet.providerID, "saia")
  assert.deepEqual(
    harness.calls.modelsSet.models.map((model) => model.id),
    ["best-for-agentic", "glm-5.3-flash", "qwen3.6-35b-a3b"],
  )
  assert.deepEqual(
    harness.calls.modelsSet.models.find((model) => model.id === "glm-5.3-flash").limit,
    { context: 200000, output: 8192 },
  )

  assert.deepEqual(harness.calls.defaultSet, { providerID: "saia", modelID: "glm-5.3-flash" })

  assert.equal(harness.savedSettings().v2ManagedModels["glm-5.3-flash"].name, "GLM 5.3 Flash")

  // http.response hook persists quota headers as session metadata.
  const response = new Response("", {
    headers: {
      "x-ratelimit-remaining-minute": "26",
      "x-ratelimit-remaining-hour": "128",
    },
  })
  await harness.calls.hooks[0].callback({
    sessionID: "ses_1",
    model: { providerID: "saia", id: "glm-5.3-flash" },
    response,
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(harness.calls.sessionUpdates.length, 1)
  assert.equal(harness.calls.sessionUpdates[0].sessionID, "ses_1")
  assert.equal(harness.calls.sessionUpdates[0].metadata.saiaLimits.minute, "26")

  // The context hook merges Qwen system parts in place.
  const system = [{ type: "text", text: "One" }, { type: "text", text: "Two" }]
  await harness.calls.hooks[1].callback({
    model: { providerID: "saia", id: "qwen3.6-35b-a3b" },
    system,
  })
  assert.deepEqual(system, [{ type: "text", text: "One\n\nTwo" }])
})

test("v2 setup falls back to editor.add when the provider is not configured", async () => {
  const harness = createV2Harness({ defaultModel: { providerID: "saia", modelID: "glm-5.3-flash" } })
  const editor = {
    get: () => undefined,
    update: () => assert.fail("update must not run for an absent provider"),
    add: (input) => {
      harness.calls.added = input
    },
  }
  harness.ctx.provider.transform = async (update) => update(editor)

  await harness.setup(harness.ctx)

  assert.equal(harness.calls.modelsSet, undefined)
  assert.equal(harness.calls.added.info.id, "saia")
  assert.equal(harness.calls.added.info.settings.apiKey, "test-key")
  assert.equal(harness.calls.added.models.length, 3)
  // Existing default stays untouched when it is still available.
  assert.equal(harness.calls.defaultSet, undefined)
})

test("v2 setup leaves a foreign default model alone", async () => {
  const harness = createV2Harness({ defaultModel: { providerID: "anthropic", modelID: "claude-test" } })

  await harness.setup(harness.ctx)

  assert.equal(harness.calls.defaultSet, undefined)
})

test("v2 setup registers hooks even when the SAIA API fails", async () => {
  const harness = createV2Harness({ models: { malformed: true } })
  const warnings = []
  harness.setup = createSaiaV2Setup({
    async fetch() {
      return new Response("nope", { status: 503 })
    },
    async resolveApiKey() {
      return "key"
    },
    async resolveTransport() {
      return { id: "chat-completions", npm: "@ai-sdk/openai-compatible" }
    },
    async readSettings() {
      return {}
    },
    async updateSettings() {},
    async fetchWithCache(fetcher) {
      return { data: await fetcher(), cached: false }
    },
    async getContext() {
      return {}
    },
    async getPreferences() {
      return {}
    },
    async updateMetrics() {},
    onWarning(message) {
      warnings.push(message)
    },
  })

  await harness.setup(harness.ctx)

  assert.equal(harness.calls.hooks.length, 2)
  assert.equal(harness.calls.modelsSet, undefined)
  assert.ok(warnings.some((message) => message.includes("SAIA API returned 503")))
})
