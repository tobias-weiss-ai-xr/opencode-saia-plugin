// OpenCode v2 (2.0+) plugin adapter. Pure functions, no runtime imports from
// @opencode/plugin: installed plugin files live outside this package's
// node_modules, so Model.Info / Provider.Info objects are built inline.
//
// Shapes follow @opencode/plugin@2.0.20:
//   Model.Info.default() => { id, modelID, providerID, name, capabilities,
//     variants, time, cost, status, enabled, limit }
//   Provider.Info        => { id, name, activation, package, settings, ... }

import { SAIA_BASE_URL } from "./saia-config.mjs"

export const SAIA_PROVIDER_ID = "saia"
export const DEFAULT_SAIA_MODEL = "glm-5.3-flash"

// V1 config used @ai-sdk/* package ids; v2 renames the provider packages.
const V2_PACKAGES = Object.freeze({
  "chat-completions": "@opencode/ai/providers/openai-compatible",
  responses: "@opencode/ai/providers/openai",
})

export function v2ProviderPackage(transport) {
  return V2_PACKAGES[transport?.id] ?? V2_PACKAGES["chat-completions"]
}

const ATTACHMENT_INPUTS = new Set(["image", "audio", "video"])

function asList(value) {
  return Array.isArray(value) ? value : []
}

function modalities(value, fallback) {
  const list = asList(value).filter((entry) => typeof entry === "string" && entry)
  return list.length > 0 ? list : fallback
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function sortedJSON(value) {
  if (Array.isArray(value)) return value.map(sortedJSON)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedJSON(value[key])]),
  )
}

function sameValue(left, right) {
  return JSON.stringify(sortedJSON(left)) === JSON.stringify(sortedJSON(right))
}

// Builds a full v2 Model.Info for one SAIA /v1/models entry. Context and output
// limits stay at the SDK default (0 = unknown): SAIA's API does not report them
// and a hardcoded guess silently goes stale. Curated limits in opencode.json
// still win via the existing-model overlay below.
export function saiaModelInfoFromApiModel(model) {
  const id = typeof model?.id === "string" ? model.id : ""
  const output = modalities(model?.output, ["text"])
  const input = modalities(
    model?.input,
    asList(model?.input).some((modality) => ATTACHMENT_INPUTS.has(modality)) ? ["text", "image"] : ["text"],
  )

  return {
    id,
    modelID: id,
    providerID: SAIA_PROVIDER_ID,
    name: typeof model?.name === "string" && model.name ? model.name : id,
    capabilities: {
      tools: true,
      input,
      output,
    },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 0, output: 0 },
    settings: {
      "enable-tools": true,
      "enable-auto-tool-choice": true,
      "tool-call-parser": "openai",
    },
  }
}

// Overlays a user-configured (or opencode-translated) Model.Info on the
// generated defaults. Identity fields never change; settings merge.
function overlayModelInfo(base, overlay) {
  if (!isRecord(overlay)) return base

  const merged = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue
    if (key === "id" || key === "modelID" || key === "providerID") continue
    if (key === "settings") {
      merged.settings = { ...base.settings, ...value }
    } else {
      merged[key] = value
    }
  }
  return merged
}

// v2 counterpart of decorateSaiaConfig (saia-config.mjs):
// - discovered models become generated Model.Info entries
// - existing provider inventory overlays them (curated limits, names, ...)
// - existing models the plugin no longer generates are dropped, unless the
//   user modified them since (tracked via the v2ManagedModels snapshot in
//   ~/.config/opencode/saia.json)
export function decorateSaiaV2Provider({
  models,
  existingModels = [],
  managedModels = {},
  preferredModel,
} = {}) {
  const generated = asList(models)
    .filter((model) => typeof model?.id === "string" && model.id)
    .map((model) => saiaModelInfoFromApiModel(model))
    .sort((a, b) => a.id.localeCompare(b.id))

  const generatedIDs = new Set(generated.map((model) => model.id))
  const existingByID = new Map(
    asList(existingModels)
      .filter((model) => typeof model?.id === "string")
      .map((model) => [model.id, model]),
  )

  const merged = generated.map((model) => overlayModelInfo(model, existingByID.get(model.id)))

  for (const [id, model] of existingByID) {
    if (generatedIDs.has(id)) continue
    const priorGenerated = managedModels[id]
    // Drop a model only when the plugin created it earlier AND the user never
    // customized it. Unknown models belong to the user.
    if (priorGenerated && sameValue(model, priorGenerated)) continue
    merged.push(model)
  }

  merged.sort((a, b) => a.id.localeCompare(b.id))

  const modelIDs = merged.map((model) => model.id)
  const firstAvailable = modelIDs.includes(DEFAULT_SAIA_MODEL) ? DEFAULT_SAIA_MODEL : modelIDs[0]
  const selected = preferredModel && modelIDs.includes(preferredModel) ? preferredModel : firstAvailable

  return {
    modelIDs,
    models: merged,
    managedModels: Object.fromEntries(generated.map((model) => [model.id, model])),
    selected,
  }
}

// Fallback provider definition for setups without a saia block in opencode.json.
export function saiaProviderInfo({ package: providerPackage, apiKey }) {
  return {
    id: SAIA_PROVIDER_ID,
    name: "SAIA",
    activation: "enabled",
    package: providerPackage,
    settings: {
      baseURL: SAIA_BASE_URL,
      ...(apiKey ? { apiKey } : {}),
    },
  }
}

// The current default model is unavailable (e.g. glm-4.7 after SAIA retired it)
// or unset: the plugin should repoint the default to a live SAIA model.
export function shouldReplaceDefaultModel(current, modelIDs) {
  if (!current) return true
  if (current.providerID !== SAIA_PROVIDER_ID) return false
  return !modelIDs.includes(current.modelID)
}
