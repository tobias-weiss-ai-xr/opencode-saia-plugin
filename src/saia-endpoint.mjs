// Reads and writes the two settings that decide how SAIA is reached: the transport
// (which client package) and the baseURL (which host). They are independent — both
// SAIA hosts serve /chat/completions and /responses.

import { realpath } from "node:fs/promises"
import { pathToFileURL } from "node:url"

import {
  DEFAULT_SAIA_BASE_URL,
  DEFAULT_SAIA_TRANSPORT,
  isSaiaTransport,
  normalizeSaiaBaseURL,
  resolveSaiaBaseURL,
  resolveSaiaTransport,
} from "./saia-transport.mjs"
import {
  defaultSaiaConfigDir,
  readSaiaSettings,
  saiaConfigPath,
  updateSaiaSettings,
} from "./saia-settings.mjs"

// Named so `--host gwdg` is enough; a full URL is still accepted.
export const SAIA_HOST_ALIASES = Object.freeze({
  academiccloud: "https://chat-ai.academiccloud.de/v1",
  gwdg: "https://saia.gwdg.de/v1",
})

export function resolveHostArgument(value) {
  if (Object.hasOwn(SAIA_HOST_ALIASES, value)) return SAIA_HOST_ALIASES[value]

  const normalized = normalizeSaiaBaseURL(value)
  if (normalized) return normalized

  throw new Error(
    `Host must be a URL or one of: ${Object.keys(SAIA_HOST_ALIASES).join(", ")}. Received "${value}".`,
  )
}

export function parseArguments(argv) {
  const parsed = { show: false }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const takeValue = () => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${flag} needs a value.`)
      index += 1
      return value
    }

    switch (flag) {
      case "--show":
        parsed.show = true
        break
      case "--transport":
        parsed.transport = takeValue()
        break
      case "--host":
      case "--base-url":
        parsed.host = takeValue()
        break
      case "--config-dir":
        parsed.configDir = takeValue()
        break
      case "--reset-host":
        parsed.host = null
        break
      default:
        throw new Error(`Unknown option "${flag}".`)
    }
  }

  return parsed
}

export async function readEndpoint(configDir = defaultSaiaConfigDir()) {
  const onWarning = () => {}
  const [transport, baseURL, settings] = await Promise.all([
    resolveSaiaTransport({ configDir, onWarning }),
    resolveSaiaBaseURL({ configDir, onWarning }),
    readSaiaSettings({ configDir, onWarning }),
  ])

  return {
    transport: transport.id,
    npm: transport.npm,
    baseURL,
    transportIsDefault: settings.transport === undefined,
    baseURLIsDefault: settings.baseURL === undefined,
    configPath: saiaConfigPath(configDir),
  }
}

export async function applyEndpoint({ transport, host, configDir = defaultSaiaConfigDir() } = {}) {
  if (transport !== undefined && !isSaiaTransport(transport)) {
    throw new Error('Transport must be either "chat-completions" or "responses".')
  }
  // `host: null` clears the override; undefined leaves it untouched.
  const baseURL = host === undefined || host === null ? host : resolveHostArgument(host)

  const { configPath } = await updateSaiaSettings((current) => {
    const next = { ...current }
    if (transport !== undefined) next.transport = transport
    if (baseURL === null) delete next.baseURL
    else if (baseURL !== undefined) next.baseURL = baseURL
    return next
  }, configDir)

  return { configPath, ...(await readEndpoint(configDir)) }
}

function describe(state) {
  const transportNote = state.transportIsDefault ? ` (default: ${DEFAULT_SAIA_TRANSPORT})` : ""
  const hostNote = state.baseURLIsDefault ? ` (default: ${DEFAULT_SAIA_BASE_URL})` : ""

  return [
    `transport: ${state.transport}${transportNote}`,
    `  package: ${state.npm}`,
    `  baseURL: ${state.baseURL}${hostNote}`,
    `   config: ${state.configPath}`,
  ].join("\n")
}

function usage() {
  return [
    "Usage: node saia-endpoint.mjs [--show] [--transport <id>] [--host <alias|url>] [--reset-host]",
    "",
    "  --transport   chat-completions | responses   (which client package)",
    `  --host        ${Object.keys(SAIA_HOST_ALIASES).join(" | ")} | <url>   (which SAIA host)`,
    "  --reset-host  drop the host override and fall back to the default",
    "  --show        print the current selection without changing it",
    "",
    "Both SAIA hosts serve /chat/completions and /responses, so the two settings are independent.",
  ].join("\n")
}

async function isMainModule() {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
}

if (await isMainModule()) {
  try {
    const argv = process.argv.slice(2)
    if (argv.includes("-h") || argv.includes("--help")) {
      console.log(usage())
    } else {
      const { show, transport, host, configDir } = parseArguments(argv)
      const changing = transport !== undefined || host !== undefined

      if (show || !changing) {
        console.log(describe(await readEndpoint(configDir ?? defaultSaiaConfigDir())))
        if (!changing && !show) console.log(`\n${usage()}`)
      } else {
        const state = await applyEndpoint({ transport, host, configDir })
        console.log(describe(state))
        console.log("\nRestart OpenCode for the change to take effect.")
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
