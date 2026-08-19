import { DEFAULT_SAIA_BASE_URL } from "./saia-transport.mjs"

const INTERNAL_SESSION_HEADER = "x-opencode-saia-session"
// Tracks the default host, so a config that never reached the resolver still records quota.
const SAIA_ORIGIN = new URL(DEFAULT_SAIA_BASE_URL).origin
const WRAPPED_FETCH = Symbol.for("opencode-saia-plugin.limits-fetch")

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

function subagentNameOf(session) {
  if (!session?.parentID) return undefined
  if (typeof session.agent === "string" && session.agent.trim()) {
    return session.agent.trim()
  }
  if (typeof session.title === "string") {
    const match = session.title.match(/@([\w-]+)\s+subagent/i)
    if (match) return match[1]
  }
  return "subagent"
}

async function saveLimits(client, sessionID, limits) {
  const transport = client?._client
  if (!transport || typeof transport.get !== "function" || typeof transport.patch !== "function") {
    throw new Error("OpenCode's HTTP client is unavailable")
  }

  // OpenCode 1.18.16 supports session metadata, but its generated SDK wrapper
  // omits that field. Use the same configured transport directly so its
  // directory and authentication context are retained.
  const current = unwrap(
    await transport.get({
      url: "/session/{sessionID}",
      path: { sessionID },
    }),
  )
  const metadata =
    current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
      ? current.metadata
      : {}

  const isSubagent = Boolean(current?.parentID)
  const subagentName = subagentNameOf(current)
  const subagent = isSubagent ? subagentName || true : false

  await transport.patch({
    url: "/session/{sessionID}",
    path: { sessionID },
    headers: { "Content-Type": "application/json" },
    body: {
      metadata: {
        ...metadata,
        saiaLimits: {
          ...limits,
          subagent,
        },
      },
    },
  })

  if (isSubagent && current?.parentID) {
    try {
      const parent = unwrap(
        await transport.get({
          url: "/session/{sessionID}",
          path: { sessionID: current.parentID },
        }),
      )
      const parentMetadata =
        parent?.metadata && typeof parent.metadata === "object" && !Array.isArray(parent.metadata)
          ? parent.metadata
          : {}

      const prevSubagents =
        parentMetadata.saiaSubagents && typeof parentMetadata.saiaSubagents === "object"
          ? parentMetadata.saiaSubagents
          : {}

      const subagentModel = current?.model?.modelID || ""
      const updatedSubagents = {
        ...prevSubagents,
        [sessionID]: {
          id: sessionID,
          name: subagentName || "subagent",
          model: subagentModel,
          updated: Date.now(),
        },
      }

      await transport.patch({
        url: "/session/{sessionID}",
        path: { sessionID: current.parentID },
        headers: { "Content-Type": "application/json" },
        body: {
          metadata: {
            ...parentMetadata,
            saiaSubagents: updatedSubagents,
            saiaSubagentLimits: {
              ...limits,
              subagent: subagentName || true,
              model: subagentModel,
            },
            saiaLimits: {
              ...limits,
              subagent: subagentName || true,
              model: subagentModel,
            },
          },
        },
      })
    } catch {
      // Failure to update parent metadata is non-fatal.
    }
  }
}

export function createSaiaLimitsHooks(client, { onWarning = console.warn } = {}) {
  const pendingWrites = new Map()

  function enqueueLimitsSave(sessionID, limits) {
    const previous = pendingWrites.get(sessionID) ?? Promise.resolve()
    const current = previous
      .catch(() => {})
      .then(() => saveLimits(client, sessionID, limits))

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

export default {
  id: "saia-limits-server",
  server: async ({ client }) => createSaiaLimitsHooks(client),
}
