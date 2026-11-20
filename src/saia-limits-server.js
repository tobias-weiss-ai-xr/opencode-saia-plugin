const INTERNAL_SESSION_HEADER = "x-opencode-saia-session"
const SAIA_ORIGIN = "https://chat-ai.academiccloud.de"
const WRAPPED_FETCH = Symbol.for("opencode-saia-plugin.limits-fetch")

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requestURL(input) {
  try {
    if (typeof input === "string") return new URL(input)
    if (input instanceof URL) return input
    if (input && typeof input.url === "string") return new URL(input.url)
  } catch {}
}

// Match the provider's own baseURL rather than SAIA's hostname, so the quota headers
// are still read when requests are routed through a proxy (a local one, or LiteLLM)
// that forwards them. Falls back to SAIA's origin if baseURL is missing or unparseable.
function providerOrigin(options) {
  try {
    if (options?.baseURL) return new URL(options.baseURL).origin
  } catch {}
  return SAIA_ORIGIN
}

function requestHeaders(input, init) {
  const headers = new Headers()
  const inputHeaders = input instanceof Request ? input.headers : input?.headers

  if (inputHeaders) {
    new Headers(inputHeaders).forEach((value, key) => headers.set(key, value))
  }
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  }

  return headers
}

function unwrap(result) {
  if (result && typeof result === "object" && "data" in result) return result.data
  return result
}

function quotaHeader(response, name) {
  // LiteLLM exposes upstream provider headers with this prefix.
  return response.headers.get(name) ?? response.headers.get(`llm_provider-${name}`)
}

function limitsFrom(response) {
  const limits = {
    minute: quotaHeader(response, "x-ratelimit-remaining-minute"),
    hour: quotaHeader(response, "x-ratelimit-remaining-hour"),
    day: quotaHeader(response, "x-ratelimit-remaining-day"),
    month: quotaHeader(response, "x-ratelimit-remaining-month"),
    resetSec: quotaHeader(response, "ratelimit-reset"),
  }

  if (Object.values(limits).every((value) => value === null)) return

  return {
    ...limits,
    updatedAt: new Date().toISOString(),
  }
}

// Persists quota snapshots as session metadata. `target` is either an OpenCode 2.x
// session domain ({ get, update }) or a V1 SDK client whose raw HTTP transport is
// used directly (the V1 generated wrapper omits the metadata field).
async function saveLimits(target, sessionID, limits) {
  if (typeof target?.get === "function" && typeof target?.update === "function") {
    const current = await target.get({ sessionID })
    const metadata = isRecord(current?.metadata) ? current.metadata : {}
    await target.update({ sessionID, metadata: { ...metadata, saiaLimits: limits } })
    return
  }

  const transport = target?._client
  if (!transport || typeof transport.get !== "function" || typeof transport.patch !== "function") {
    throw new Error("OpenCode's HTTP client is unavailable")
  }

  const current = unwrap(
    await transport.get({
      url: "/session/{sessionID}",
      path: { sessionID },
    }),
  )
  const metadata = isRecord(current?.metadata) ? current.metadata : {}

  await transport.patch({
    url: "/session/{sessionID}",
    path: { sessionID },
    headers: { "Content-Type": "application/json" },
    body: {
      metadata: {
        ...metadata,
        saiaLimits: limits,
      },
    },
  })
}

function createLimitsSaver(target, { onWarning = console.warn } = {}) {
  const pendingWrites = new Map()

  function enqueueLimitsSave(sessionID, limits) {
    const previous = pendingWrites.get(sessionID) ?? Promise.resolve()
    const current = previous
      .catch(() => {})
      .then(() => saveLimits(target, sessionID, limits))

    pendingWrites.set(sessionID, current)
    void current.then(
      () => {
        if (pendingWrites.get(sessionID) === current) pendingWrites.delete(sessionID)
      },
      (error) => {
        onWarning(
          `[SAIA] Failed to save rate limits: ${error instanceof Error ? error.message : String(error)}`,
        )
        if (pendingWrites.get(sessionID) === current) pendingWrites.delete(sessionID)
      },
    )
  }

  async function flush() {
    while (pendingWrites.size > 0) {
      await Promise.allSettled([...pendingWrites.values()])
    }
  }

  return { enqueueLimitsSave, flush }
}

export function createSaiaLimitsHooks(client, { onWarning = console.warn } = {}) {
  const { enqueueLimitsSave, flush } = createLimitsSaver(client, { onWarning })

  return {
    config(config) {
      const options = config.provider?.saia?.options
      if (!options) return

      const originalFetch = options.fetch ?? globalThis.fetch
      if (typeof originalFetch !== "function" || originalFetch[WRAPPED_FETCH]) return

      const origin = providerOrigin(options)

      const wrappedFetch = async function (input, init) {
        const url = requestURL(input)
        if (url?.origin !== origin) {
          return originalFetch.call(this, input, init)
        }

        const headers = requestHeaders(input, init)
        const sessionID = headers.get(INTERNAL_SESSION_HEADER)
        if (!sessionID) {
          return originalFetch.call(this, input, init)
        }

        // This header only carries OpenCode routing state and must not leave the client.
        headers.delete(INTERNAL_SESSION_HEADER)
        const response = await originalFetch.call(this, input, { ...init, headers })
        const limits = limitsFrom(response)

        if (limits) {
          enqueueLimitsSave(sessionID, limits)
        }

        return response
      }

      Object.defineProperty(wrappedFetch, WRAPPED_FETCH, { value: true })
      options.fetch = wrappedFetch
    },

    "chat.headers"(input, output) {
      if (input.model.providerID !== "saia") return
      output.headers[INTERNAL_SESSION_HEADER] = input.sessionID
    },

    flush,
  }
}

// OpenCode 2.x: quota headers are read off the native response in the
// "http.response" session hook; no fetch wrapping needed.
export function createSaiaV2LimitsHooks(sessionDomain, { onWarning = console.warn } = {}) {
  const { enqueueLimitsSave, flush } = createLimitsSaver(sessionDomain, { onWarning })

  return {
    async "http.response"(event) {
      if (event?.model?.providerID !== "saia") return
      const limits = limitsFrom(event.response)
      if (limits) enqueueLimitsSave(event.sessionID, limits)
    },

    flush,
  }
}

export default {
  id: "saia-limits-server",
  server: async ({ client }) => createSaiaLimitsHooks(client),
}
