// Installed at ~/.config/opencode/plugins/saia/saia.ts.
// The immediate plugins/saia-plugin.ts wrapper is what OpenCode discovers; see that file.
//
// The default export is the official dual V1+V2 shape:
//   - OpenCode 2.x reads `id` + `setup(ctx)` (promise plugin API, @opencode/plugin@2.x)
//   - OpenCode 1.18.29+ calls `server()` and uses the returned V1 hooks
// See https://opencode.ai/v2/docs/build/plugins ("Support V1").

import type { Config, Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import type { Plugin as V2Plugin } from "@opencode/plugin"

import * as memory from "./saia-memory.js"
import {
  SAIA_API_KEY_PLACEHOLDER,
  decorateSaiaConfig,
  isSaiaModelsResponse,
  parseSaiaModelsResponse,
} from "./saia-config.mjs"
import { resolveSaiaApiKey } from "./saia-api-key.mjs"
import { createSaiaLimitsHooks, createSaiaV2LimitsHooks } from "./saia-limits-server.js"
import { managedModelsFromSettings, readSaiaSettings, updateSaiaSettings } from "./saia-settings.mjs"
import { resolveSaiaTransport } from "./saia-transport.mjs"
import { normalizeSaiaQwenSystemMessages, normalizeSaiaQwenSystemParts } from "./saia-system-messages.js"
import {
  SAIA_PROVIDER_ID,
  decorateSaiaV2Provider,
  saiaProviderInfo,
  shouldReplaceDefaultModel,
  v2ProviderPackage,
} from "./saia-v2.mjs"

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

// Shared between the V1 config hook and the V2 setup: fetches the SAIA model
// list once (with disk cache) and reports the first failure loudly.
function createModelLoader(dependencies: SaiaPluginDependencies) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  const resolveApiKey = dependencies.resolveApiKey ?? resolveSaiaApiKey
  const fetchWithCache = dependencies.fetchWithCache ?? memory.fetchWithCache
  const updateMetrics = dependencies.updateMetrics ?? memory.updateMetrics
  const onWarning = dependencies.onWarning ?? console.warn

  let modelsPromise: Promise<CachedModels> | undefined
  let reportedFailure = false

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
      throw new Error(helpMsg.trim())
    }

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

  return { loadModels, reportFailure }
}

export function createSaiaPlugin(dependencies: SaiaPluginDependencies = {}): Plugin {
  const { loadModels, reportFailure } = createModelLoader(dependencies)
  const resolveApiKey = dependencies.resolveApiKey ?? resolveSaiaApiKey
  const resolveTransport = dependencies.resolveTransport ?? resolveSaiaTransport
  const readSettings = dependencies.readSettings ?? readSaiaSettings
  const updateSettings = dependencies.updateSettings ?? updateSaiaSettings
  const getContext = dependencies.getContext ?? memory.getContext
  const getPreferences = dependencies.getPreferences ?? memory.getPreferences
  const onWarning = dependencies.onWarning ?? console.warn

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

    const source = result.cached ? "cached" : "fresh"
    return { count: modelIDs.length, source }
  }

  return async ({ client }: PluginInput): Promise<Hooks> => {
    const limits = createSaiaLimitsHooks(client) as SaiaLimitsHooks

    return {
      async config(config) {
        const result = await configureSaia(config)
        if (result) {
          console.log(`[SAIA] Configured ${result.count} models (${result.source})`)
          try {
            await client.app.log({
              body: {
                service: "saia",
                level: "info",
                message: `configured ${result.count} models (${result.source})`,
              },
            })
          } catch {
            // Logging must not affect configuration or provider availability.
          }
        }
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

// OpenCode 2.x setup. Provider/model state is edited through transforms; the
// rate-limit tracker reads quota headers off native responses.
export function createSaiaV2Setup(dependencies: SaiaPluginDependencies = {}) {
  const { loadModels, reportFailure } = createModelLoader(dependencies)
  const resolveApiKey = dependencies.resolveApiKey ?? resolveSaiaApiKey
  const resolveTransport = dependencies.resolveTransport ?? resolveSaiaTransport
  const readSettings = dependencies.readSettings ?? readSaiaSettings
  const updateSettings = dependencies.updateSettings ?? updateSaiaSettings
  const getContext = dependencies.getContext ?? memory.getContext
  const getPreferences = dependencies.getPreferences ?? memory.getPreferences
  const onWarning = dependencies.onWarning ?? console.warn

  return async (ctx: V2Plugin.Context) => {
    const limits = createSaiaV2LimitsHooks(ctx.session)

    await ctx.session.hook(
      "http.response",
      (event) => limits["http.response"](event),
      { providerID: SAIA_PROVIDER_ID },
    )
    await ctx.session.hook("context", (event) => {
      normalizeSaiaQwenSystemParts(event.model, event.system)
    })

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
    const apiKey = (await resolveApiKey()) ?? undefined

    let outcome: ReturnType<typeof decorateSaiaV2Provider> | undefined
    await ctx.provider.transform((editor) => {
      const record = editor.get(SAIA_PROVIDER_ID)
      const existingModels = record ? [...record.models.values()] : []
      outcome = decorateSaiaV2Provider({
        models: result.data.data,
        existingModels,
        managedModels:
          settings && typeof settings.v2ManagedModels === "object" && settings.v2ManagedModels !== null
            ? (settings.v2ManagedModels as Record<string, unknown>)
            : {},
        preferredModel: preferredModelFrom(context, preferences),
      })

      if (record) {
        editor.models.set(SAIA_PROVIDER_ID, outcome.models)
        editor.update(SAIA_PROVIDER_ID, (provider) => {
          const current = provider.settings?.["apiKey"]
          if (apiKey && (!current || current === SAIA_API_KEY_PLACEHOLDER)) {
            provider.settings = { ...provider.settings, apiKey }
          }
        })
      } else {
        editor.add({
          info: saiaProviderInfo({ package: v2ProviderPackage(transport), apiKey }),
          models: outcome.models,
        })
      }
    })
    if (!outcome) return

    await ctx.model.transform((editor) => {
      const current = editor.default.get()
      if (shouldReplaceDefaultModel(current, outcome.modelIDs) && outcome.selected) {
        editor.default.set(SAIA_PROVIDER_ID, outcome.selected)
      }
    })

    try {
      const managed = outcome.managedModels
      await updateSettings((current) => ({ ...current, v2ManagedModels: managed }))
    } catch (error) {
      onWarning(`[SAIA] Could not record managed model metadata: ${errorMessage(error)}`)
    }

    const source = result.cached ? "cached" : "fresh"
    console.log(`[SAIA] Configured ${outcome.modelIDs.length} models via ${transport.id} (${source})`)
  }
}

export function createSaiaPluginDefinition(dependencies: SaiaPluginDependencies = {}) {
  return {
    id: SAIA_PROVIDER_ID,
    setup: createSaiaV2Setup(dependencies),
    server: createSaiaPlugin(dependencies),
  }
}

export default createSaiaPluginDefinition()
