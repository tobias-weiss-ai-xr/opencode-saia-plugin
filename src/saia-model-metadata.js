// SAIA's /v1/models describes each deployment beyond its id:
//
//   { "id": "qwen3.5-397b-a17b", "name": "Qwen 3.5 397B A17B",
//     "input": ["text","image"], "output": ["text","thought"], "status": "ready" }
//
// Deriving OpenCode's model fields from that keeps them correct as SAIA changes its
// line-up. Context and output token limits are deliberately not set here: the API does
// not report them, so any value would be a hardcoded guess that silently goes stale.
// Add them per model in your own config instead — OpenCode deep-merges them in.

import { SAIA_ALIASES, buildSaiaAliasConfig } from "./saia-aliases.mjs"

// The model a fresh install selects. Kept here because both the V1 config hook
// and the V2 provider transform need it, and importing it from either would
// create an import cycle.
export const DEFAULT_SAIA_MODEL = "deepseek-v4-flash-0731"

const ATTACHMENT_INPUTS = new Set(["image", "audio", "video"])

function asList(value) {
  return Array.isArray(value) ? value : []
}

export function buildSaiaModel(model) {
  const id = model?.id
  const built = {
    name: typeof model?.name === "string" && model.name ? model.name : id,
    options: {
      "enable-tools": true,
      "enable-auto-tool-choice": true,
      "tool-call-parser": "openai",
    },
  }

  if (asList(model?.input).some((modality) => ATTACHMENT_INPUTS.has(modality))) {
    built.attachment = true
  }
  if (asList(model?.output).includes("thought")) {
    built.reasoning = true
  }

  return built
}

export function buildSaiaModels(models) {
  const entries = asList(models)
    .filter((model) => typeof model?.id === "string" && model.id)
    .sort((a, b) => a.id.localeCompare(b.id))

  const built = Object.fromEntries(entries.map((model) => [model.id, buildSaiaModel(model)]))

  // Aliases are only registered while their target is in today's line-up, so a
  // shortcut can never point at a retired model.
  for (const alias of Object.keys(SAIA_ALIASES)) {
    const target = built[SAIA_ALIASES[alias]]
    if (target) built[alias] = buildSaiaAliasConfig(alias, target)
  }

  return built
}
