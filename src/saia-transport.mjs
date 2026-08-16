import { readSaiaSettings, saiaConfigPath } from "./saia-settings.mjs"

export { saiaConfigPath } from "./saia-settings.mjs"

export const DEFAULT_SAIA_TRANSPORT = "chat-completions"

// SAIA answers on two hostnames, this one and https://saia.gwdg.de/v1; both serve
// /chat/completions and /responses. Override with "baseURL" in saia.json.
export const DEFAULT_SAIA_BASE_URL = "https://chat-ai.academiccloud.de/v1"

// The npm package decides which endpoint under the shared /v1 baseURL is used:
// @ai-sdk/openai-compatible calls /chat/completions, @ai-sdk/openai calls /responses.
// The transport does not constrain the host — both hosts serve both endpoints.
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

// Reject anything the provider SDK and the quota tracker could not parse, and drop a
// trailing slash so appending "/models" never yields a doubled separator.
export function normalizeSaiaBaseURL(value) {
  if (typeof value !== "string" || !value.trim()) return
  try {
    new URL(value.trim())
    return value.trim().replace(/\/+$/, "")
  } catch {}
}

function usableBaseURL(value, source, onWarning) {
  const normalized = normalizeSaiaBaseURL(value)
  if (normalized) return normalized
  onWarning(`[SAIA] Ignoring unusable baseURL "${value}" from ${source}; using ${DEFAULT_SAIA_BASE_URL}.`)
}

// The host is a user choice independent of the transport. Model discovery and chat
// traffic must agree on it, so both read this one resolver.
export async function resolveSaiaBaseURL({ configDir, onWarning = console.warn } = {}) {
  const config = await readSaiaSettings({ configDir, onWarning })
  if (typeof config.baseURL === "string" && config.baseURL.trim()) {
    const resolved = usableBaseURL(config.baseURL.trim(), saiaConfigPath(configDir), onWarning)
    if (resolved) return resolved
  }

  return DEFAULT_SAIA_BASE_URL
}
