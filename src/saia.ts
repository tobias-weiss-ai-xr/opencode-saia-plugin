// Installed at ~/.config/opencode/plugins/saia/saia.ts.
// The immediate plugins/saia-plugin.ts wrapper is what OpenCode discovers; see that file.

import type { Config, Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"

import * as memory from "./saia-memory.js"
import {
  SAIA_API_KEY_PLACEHOLDER,
  decorateSaiaConfig,
  isSaiaModelsResponse,
  parseSaiaModelsResponse,
} from "./saia-config.mjs"
import { resolveSaiaApiKey } from "./saia-api-key.mjs"
import { createSaiaLimitsHooks } from "./saia-limits-server.js"
import { managedModelsFromSettings, readSaiaSettings, updateSaiaSettings } from "./saia-settings.mjs"
import { resolveSaiaTransport } from "./saia-transport.mjs"
import { normalizeSaiaQwenSystemMessages } from "./saia-system-messages.js"

const ENDPOINT = "https://chat-ai.academiccloud.de/v1/models"

type SaiaModelsResponse = {
  data: Array<Record<string, unknown> & { id: string }>
}

type CachedModels = {
  data: SaiaModelsResponse
  cached: boolean
}

type SaiaLimitsHooks = {
  config: (config: Config) => void | Promise<void>
  "chat.headers": NonNullable<Hooks["chat.headers"]>
}

export interface SaiaPluginDependencies {
  fetch?: typeof globalThis.fetch
  resolveApiKey?: typeof resolveSaiaApiKey
  resolveTransport?: typeof resolveSaiaTransport
  readSettings?: typeof readSaiaSettings
  updateSettings?: typeof updateSaiaSettings
  fetchWithCache?: typeof memory.fetchWithCache
  getContext?: typeof memory.getContext
  getPreferences?: typeof memory.getPreferences
  updateMetrics?: typeof memory.updateMetrics
  onWarning?: (message: string) => void
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function preferredModelFrom(context: Record<string, unknown>, preferences: Record<string, unknown>) {
  if (typeof context.preferredModel === "string") return context.preferredModel
  if (typeof preferences.favoriteModel === "string") return preferences.favoriteModel
}

export function createSaiaPlugin(dependencies: SaiaPluginDependencies = {}): Plugin {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  const resolveApiKey = dependencies.resolveApiKey ?? resolveSaiaApiKey
  const resolveTransport = dependencies.resolveTransport ?? resolveSaiaTransport
  const readSettings = dependencies.readSettings ?? readSaiaSettings
  const updateSettings = dependencies.updateSettings ?? updateSaiaSettings
  const fetchWithCache = dependencies.fetchWithCache ?? memory.fetchWithCache
  const getContext = dependencies.getContext ?? memory.getContext
  const getPreferences = dependencies.getPreferences ?? memory.getPreferences
  const updateMetrics = dependencies.updateMetrics ?? memory.updateMetrics
  const onWarning = dependencies.onWarning ?? console.warn

  return async ({ client }: PluginInput): Promise<Hooks> => {
    const limits = createSaiaLimitsHooks(client) as SaiaLimitsHooks
    let modelsPromise: Promise<CachedModels> | undefined
    let reportedFailure = false
    let loggedRefresh = false

    const reportFailure = (error: unknown) => {
      if (reportedFailure) return
      reportedFailure = true
      const msg = errorMessage(error)
      // Issue #4: Console + warning ensures visibility when no API key configured
      console.error(`[SAIA] ${msg}`)
      onWarning(`[SAIA] ${msg}`)
    }

    const fetchModels = async (): Promise<SaiaModelsResponse> => {
      const apiKey = await resolveApiKey()
      if (!apiKey) {
        const helpMsg = `
[SAIA] NO API KEY SET.
Please configure one of:
  1. Environment variable: SAIA_API_KEY="your-key"
  2. apiKeyCommand in ~/.config/opencode/saia.json
  3. Run: /set-saia-api-key

Get your key: https://chat-ai.academiccloud.de
`
        throw new Error(helpMsg.trim())}


      const startedAt = Date.now()
      try {
        const response = await fetchImpl(ENDPOINT, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(3_000),
        })
        if (!response.ok) {
          throw new Error(`SAIA API returned ${response.status}: ${response.statusText}`)
        }

        const data = parseSaiaModelsResponse(await response.json(), { onWarning })
        if (data.data.length === 0) {
          throw new Error("SAIA API returned no ready models")
        }

        await updateMetrics("api", true, Date.now() - startedAt)
        return data
      } catch (error) {
        await updateMetrics("api", false, Date.now() - startedAt)
        throw error
      }
    }

    const loadModels = () => {
      if (!modelsPromise) {
        modelsPromise = (async () => {
          const startedAt = Date.now()
          try {
            const result = await fetchWithCache(fetchModels, {
              isValid: isSaiaModelsResponse,
              onInvalidCache: onWarning,
            })
            await updateMetrics("refresh", true, Date.now() - startedAt)
            return result
          } catch (error) {
            await updateMetrics("refresh", false, Date.now() - startedAt)
            throw error
          }
        })()
        void modelsPromise.catch(() => {
          modelsPromise = undefined
        })
      }
      return modelsPromise
    }

    const configureSaia = async (config: Config) => {
      let result: CachedModels
      try {
        result = await loadModels()
      } catch (error) {
        reportFailure(error)
        return
      }

      const settings = await readSettings({ onWarning })
      const [context, preferences, transport] = await Promise.all([
        getContext(),
        getPreferences(),
        resolveTransport({ onWarning }),
      ])
      const { modelIDs, managedModels } = decorateSaiaConfig(config, {
        models: result.data.data,
        transport,
        preferredModel: preferredModelFrom(context, preferences),
        managedModels: managedModelsFromSettings(settings),
      })

      const options = config.provider?.saia?.options
      if (options && (!options.apiKey || options.apiKey === SAIA_API_KEY_PLACEHOLDER)) {
        const apiKey = await resolveApiKey()
        if (apiKey) options.apiKey = apiKey
      }

      try {
        await updateSettings((current) => ({ ...current, managedModels }))
      } catch (error) {
        onWarning(`[SAIA] Could not record managed model metadata: ${errorMessage(error)}`)
      }

      if (!loggedRefresh) {
        loggedRefresh = true
        const source = result.cached ? "cached" : "fresh"
        console.log(`[SAIA] Configured ${modelIDs.length} models via ${transport.id} (${source})`)
        try {
          await client.app.log({
            body: {
              service: "saia",
              level: "info",
              message: `configured ${modelIDs.length} models (${source})`,
            },
          })
        } catch {
          // Logging must not affect configuration or provider availability.
        }
      }
    }

    return {
      async config(config) {
        await configureSaia(config)
        await limits.config(config)
      },

      async "chat.headers"(input, output) {
        await limits["chat.headers"](input, output)
      },

      async "experimental.chat.system.transform"(input, output) {
        normalizeSaiaQwenSystemMessages(input.model, output.system)
      },
    }
  }
}

export default createSaiaPlugin()
