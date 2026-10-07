// Single source of truth for the `saia/*` convenience aliases.
//
// Why an alias needs `id`: OpenCode looks a model up by the key under
// `provider.<id>.models.<key>` and sends that key upstream unless the entry
// declares `id`. An alias entry therefore MUST carry `id: "<target>"`, otherwise
// OpenCode asks SAIA for `best-for-coding` and the request comes back
// `404 Model Not Found`.
//
// Both the runtime plugin (src/saia-model-metadata.js) and the config generator
// (scripts/sync-saia-models.sh) read this map, so the alias surface cannot drift
// between the two installation paths.
export const SAIA_ALIASES = Object.freeze({
  "best-for-coding": "qwen3-coder-next",
  "best-for-reasoning": "qwen3.5-397b-a17b",
  "best-quality": "qwen3.5-397b-a17b",
  "best-for-vision": "qwen3.8-27b",
  "best-for-agentic": "glm-5.3-flash",
  fastest: "meta-llama-3.1-8b-instruct",
  "fastest-reasoning": "qwen3.8-27b",
  budget: "deepseek-v4-flash-0731",
})

export const SAIA_ALIAS_IDS = Object.freeze(Object.keys(SAIA_ALIASES))

export function isSaiaAlias(id) {
  return typeof id === "string" && Object.hasOwn(SAIA_ALIASES, id)
}

/** `alias|target` rows, the shape scripts/sync-saia-models.sh consumes. */
export function saiaAliasRows() {
  return Object.entries(SAIA_ALIASES).map(([alias, target]) => `${alias}|${target}`)
}

/**
 * Project an alias onto its target's OpenCode model entry.
 *
 * Capabilities are inherited rather than re-declared: an alias that advertised
 * different limits or modalities than the model it points at is exactly how the
 * two surfaces drifted before.
 */
export function buildSaiaAliasConfig(alias, targetEntry) {
  return {
    ...targetEntry,
    id: SAIA_ALIASES[alias],
    name: `${alias} → ${SAIA_ALIASES[alias]}`,
  }
}
