// Prune stale model entries from an opencode.json by reconciling each provider's
// configured models against its live /v1/models endpoint. Providers without an
// OpenAI-compatible baseURL or without configured models are left untouched.
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const DEFAULT_CONFIG = path.join(homedir(), ".config", "opencode", "opencode.json")
const BACKUP_DIR = process.env.SAIA_BACKUP_DIR || path.join(homedir(), ".cache", "saia", "config-backups")

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function resolveApiKey(value, env) {
  if (typeof value !== "string") return undefined
  const match = value.match(/^\{\s*env:([^}]+)\s*\}$/)
  // non-env placeholders (e.g. a literal key) are sent as-is
  return match ? env[match[1]] : value
}

/** Returns keys that are neither live nor a shorter id a live id ends with (`meta-llama/llama-4-maverick` keeps `llama-4-maverick`). */
export function pruneStaleModels(liveIds, configuredIds) {
  return configuredIds.filter((id) => {
    const exact = liveIds.includes(id)
    const suffixed = !exact && liveIds.some((live) => live.endsWith(`/${id}`))
    return !exact && !suffixed
  })
}

/**
 * Removes provider model keys that the provider's live /v1/models no longer serves.
 * Mutates and returns the config plus a { removed, skipped } report.
 */
export async function reconcileConfig(config, { fetchImpl = fetch, env = process.env, onWarning = () => {} } = {}) {
  const report = { removed: {}, skipped: [] }
  const provider = config?.provider
  if (!isRecord(provider)) return { config, report }

  for (const [name, prov] of Object.entries(provider)) {
    if (!isRecord(prov) || !isRecord(prov.models)) continue
    const baseURL = prov.options?.baseURL
    if (typeof baseURL !== "string" || !baseURL) continue

    let liveIds
    try {
      const apiKey = resolveApiKey(prov.options?.apiKey, env)
      const res = await fetchImpl(`${baseURL.replace(/\/+$/, "")}/models`, apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const body = await res.json()
      liveIds = (body.data || []).map((model) => model.id).filter((id) => typeof id === "string")
    } catch (err) {
      report.skipped.push(name)
      onWarning(`[SAIA] Skipping ${name}: /v1/models unavailable (${err.message})`)
      continue
    }

    const stale = pruneStaleModels(liveIds, Object.keys(prov.models))
    if (stale.length > 0) {
      report.removed[name] = stale
      for (const id of stale) delete prov.models[id]
    }
  }
  return { config, report }
}

function printReport(report, log) {
  const total = Object.values(report.removed).reduce((n, ids) => n + ids.length, 0)
  for (const [provider, ids] of Object.entries(report.removed)) {
    log(`[SAIA] ${provider}: removed ${ids.length} stale model(s)`)
    ids.forEach((id) => log(`        - ${id}`))
  }
  for (const provider of report.skipped) log(`[SAIA] ${provider}: skipped (endpoint unreachable)`)
  log(`[SAIA] Done: ${total} stale model(s) removed${report.skipped.length ? `, ${report.skipped.length} provider(s) skipped` : ""}.`)
}

export async function main(argv = process.argv, { log = console.log, error = console.error } = {}) {
  const args = argv.slice(2)
  const dryRun = args.includes("--dry-run")
  if (args.includes("--help") || args.includes("-h")) {
    log(`Usage: reconcile-opencode-models [options] [config-file]\nOptions:\n  --dry-run     Report stale models without writing the config\n  -h, --help    Show this help\nDefault config: ${DEFAULT_CONFIG}`)
    return 0
  }
  const configFile = path.resolve(args.find((arg) => !arg.startsWith("--")) || DEFAULT_CONFIG)

  let rawConfig, config
  try {
    rawConfig = await readFile(configFile, "utf8")
    config = JSON.parse(rawConfig)
  } catch (err) {
    error(`[SAIA] Could not read ${configFile}: ${err.message}`)
    return 1
  }

  const { report } = await reconcileConfig(config)
  printReport(report, log)

  if (dryRun) {
    log("[SAIA] Dry run — no changes written.")
    return 0
  }

  const backup = path.join(BACKUP_DIR, `opencode.json.reconcile-${Date.now()}.bak`)
  try {
    await mkdir(BACKUP_DIR, { recursive: true })
    await writeFile(backup, rawConfig)
    await writeFile(configFile, JSON.stringify(config, null, 2) + "\n")
    log(`[SAIA] Written ${configFile} (backup: ${backup})`)
  } catch (err) {
    error(`[SAIA] Write failed, config left untouched: ${err.message}`)
    return 1
  }
  return 0
}
