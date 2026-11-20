// SAIA's Qwen 3.5 and 3.6 deployments reject requests carrying more than one leading
// system message, while OpenCode sends its prompt as several fragments. This is a
// deliberate allowlist of the deployments known to have that constraint, not a prefix
// match: a future qwen3.7 will not be merged until it is confirmed to need it.
const STRICT_QWEN_MODEL = /^qwen3\.(?:5|6)-/

function isStrictQwenSaiaModel(model) {
  return model?.providerID === "saia" && STRICT_QWEN_MODEL.test(model.id ?? "")
}

// V1 hook: `experimental.chat.system.transform` hands us plain strings.
export function normalizeSaiaQwenSystemMessages(model, system) {
  if (!isStrictQwenSaiaModel(model)) return

  const merged = system.filter((message) => message.trim().length > 0).join("\n\n")
  system.length = 0
  if (merged) system.push(merged)
}

// OpenCode 2.x `session.hook("context")`: system parts are structured
// ({ type: "text", text }). Only text parts are merged; anything else is
// left untouched rather than guessed at.
export function normalizeSaiaQwenSystemParts(model, system) {
  if (!isStrictQwenSaiaModel(model)) return
  if (!Array.isArray(system) || system.length < 2) return
  if (!system.every((part) => part?.type === "text")) return

  const merged = system
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter((text) => text.trim().length > 0)
    .join("\n\n")

  system.length = 0
  if (merged) system.push({ type: "text", text: merged })
}
