// Drop this file into ~/.config/opencode/plugins/saia.ts
// and add "plugin": ["./saia"] to ~/.config/opencode/opencode.json

import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"

import * as memory from "./saia-memory.js"

const CONFIG = path.join(os.homedir(), ".config", "opencode", "opencode.json")
const ENDPOINT = "https://chat-ai.academiccloud.de/v1/models"

const PERMISSIONS = {
  bash: "allow",
  edit: "allow",
  read: "allow",
  grep: "allow",
  glob: "allow",
  lsp: "allow",
  skill: "allow",
  task: "allow",
  webfetch: "allow",
  websearch: "allow",
  question: "allow",
  external_directory: "ask",
  doom_loop: "ask",
}

export default async ({ client }: { client: any }) => {
  refreshSaiaConfig(client).catch(() => {})
  return {}
}

async function fetchModels(): Promise<{ data: Array<{ id: string }> }> {
  const apiKey = process.env.SAIA_API_KEY
  if (!apiKey) {
    throw new Error("SAIA_API_KEY environment variable not set (stephart/flare: ensure SAIA_PROXY_URL optional and check API key through LITELLM proxy)")
  }
  const startTime = Date.now()
  const res = await fetch(ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(3000),
  })
  const latencyMs = Date.now() - startTime
  if (!res.ok) {
    await memory.updateMetrics("api", false, latencyMs)
    throw new Error(`SAIA API returned ${res.status}: ${res.statusText}`)
  }
  await memory.updateMetrics("api", true, latencyMs)
  return res.json() as { data: Array<{ id: string }> }
}

async function refreshSaiaConfig(client: any) {
  const startTime = Date.now()
  let result
  try {
    result = await memory.fetchWithCache(fetchModels)
    await memory.updateMetrics("refresh", true, Date.now() - startTime)
  } catch (err) {
    await memory.updateMetrics("refresh", false, Date.now() - startTime)
    console.error("[SAIA] Config refresh failed:", err instanceof Error ? err.message : err)
    return
  }
  if (result.cached) {
    console.log("[SAIA] Using cached model list")
  }

  const { data } = result.data
  const modelIds = data.map((m) => m.id).sort()
  if (modelIds.length === 0) {
    console.warn("[SAIA] No models available from API")
    return
  }

  let config: any = {}
  try {
    config = JSON.parse(await fs.readFile(CONFIG, "utf8"))
  } catch {
    console.warn("[SAIA] Config file missing or invalid, creating fresh config")
  }

  const models: Record<string, any> = {}
  for (const id of modelIds) {
    models[id] = {
      name: id,
      options: {
        "enable-tools": true,
        "enable-auto-tool-choice": true,
        "tool-call-parser": "openai",
      },
    }
  }

  config.$schema ??= "https://opencode.ai/config.json"
  config.permission = { ...PERMISSIONS, ...(config.permission || {}) }
  config.provider ??= {}
  config.provider.saia = {
    npm: "@ai-sdk/openai-compatible",
    name: "SAIA (GWDG Chat AI)",
    options: {
      baseURL: "https://chat-ai.academiccloud.de/v1",
      apiKey: "{env:SAIA_API_KEY}",
    },
    models,
  }

  const context = await memory.getContext()
  const prefModel = context.preferredModel || (await memory.getPreferences()).favoriteModel
  if (prefModel && modelIds.includes(prefModel)) {
    config.model = `saia/${prefModel}`
    console.log(`[SAIA] Using preferred model from preferences/context: ${prefModel}`)
  } else {
    const current = config.model
    const currentIsSaia = typeof current === "string" && current.startsWith("saia/")
    const currentId = currentIsSaia ? current.slice(5) : null
    if (!current || (currentIsSaia && !modelIds.includes(currentId!))) {
      config.model = modelIds.includes("glm-4.7") ? "saia/glm-4.7" : `saia/${modelIds[0]}`
      console.log(`[SAIA] Selected default model: ${config.model}`)
    }
  }

  const tmp = CONFIG + ".tmp"
  await fs.writeFile(tmp, JSON.stringify(config, null, 2))
  await fs.rename(tmp, CONFIG)
  console.log(`[SAIA] Config refreshed: ${modelIds.length} models (${result.cached ? "from cache" : "fresh"})`)

  try {
    await client.app.log({
      body: { service: "saia", level: "info", message: `refreshed ${modelIds.length} models (${result.cached ? "cached" : "fresh"})` },
    })
  } catch {
    console.warn("[SAIA] Failed to send log to client")
  }
}
