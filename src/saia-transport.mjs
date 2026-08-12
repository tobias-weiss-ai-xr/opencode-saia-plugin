import { readSaiaSettings, saiaConfigPath } from "./saia-settings.mjs"

export { saiaConfigPath } from "./saia-settings.mjs"

export const DEFAULT_SAIA_TRANSPORT = "chat-completions"

// The npm package decides which endpoint under the shared /v1 baseURL is used:
// @ai-sdk/openai-compatible calls /chat/completions, @ai-sdk/openai calls /responses.
export const SAIA_TRANSPORTS = Object.freeze({
  "chat-completions": Object.freeze({
    id: "chat-completions",
    npm: "@ai-sdk/openai-compatible",
  }),
  responses: Object.freeze({
    id: "responses",
    npm: "@ai-sdk/openai",
  }),
})

export function isSaiaTransport(value) {
  return typeof value === "string" && Object.hasOwn(SAIA_TRANSPORTS, value)
}

function warnInvalidTransport(value, source, onWarning) {
  onWarning(
    `[SAIA] Ignoring unsupported transport "${value}" from ${source}; using ${DEFAULT_SAIA_TRANSPORT}.`,
  )
}

export async function resolveSaiaTransport({
  configDir,
  environment = process.env,
  onWarning = console.warn,
} = {}) {
  const environmentValue = environment.SAIA_API_TRANSPORT
  if (environmentValue) {
    if (isSaiaTransport(environmentValue)) return SAIA_TRANSPORTS[environmentValue]
    warnInvalidTransport(environmentValue, "SAIA_API_TRANSPORT", onWarning)
  }

  const config = await readSaiaSettings({ configDir, onWarning })
  const configuredValue = config.transport

  if (configuredValue) {
    if (isSaiaTransport(configuredValue)) return SAIA_TRANSPORTS[configuredValue]
    warnInvalidTransport(configuredValue, saiaConfigPath(configDir), onWarning)
  }

  return SAIA_TRANSPORTS[DEFAULT_SAIA_TRANSPORT]
}
