import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { defaultSaiaConfigDir } from "./saia-settings.mjs"

export const TUI_PLUGIN_PATH = "./plugins/saia-limits-tui.tsx"

/** Options the widget understands, and the values each one accepts. */
export const TUI_PLUGIN_OPTIONS = {
  narrow: ["always", "hide"],
  placement: ["auto", "prompt", "sidebar"],
  layout: ["line", "stack"],
}

/**
 * A `plugin` entry is either `"<spec>"` or `["<spec>", {options}]`
 * (ConfigPluginV1.Spec). Matching on the spec alone is what stops a second
 * registration being appended once options are in play.
 */
function specOf(entry) {
  return Array.isArray(entry) && entry.length > 0 ? entry[0] : entry
}

function optionsOf(entry) {
  const options = Array.isArray(entry) && entry.length > 1 ? entry[1] : undefined
  return options && typeof options === "object" && !Array.isArray(options) ? options : {}
}

export function validateTuiPluginOptions(options = {}) {
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    const allowed = TUI_PLUGIN_OPTIONS[key]
    if (!allowed) throw new Error(`Unknown TUI plugin option "${key}"`)
    if (!allowed.includes(value)) {
      throw new Error(`Invalid "${key}": expected one of ${allowed.join(", ")}, got ${JSON.stringify(value)}`)
    }
  }
  return options
}

async function fileExists(file) {
  try {
    await access(file, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function installTuiPlugin(configDir = defaultSaiaConfigDir(), options = {}) {
  const requested = validateTuiPluginOptions(
    Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined && value !== "")),
  )
  await mkdir(configDir, { recursive: true })
  const configPath = path.join(configDir, "tui.json")
  let config = {}
  const exists = await fileExists(configPath)

  if (exists) {
    try {
      config = JSON.parse(await readFile(configPath, "utf8"))
    } catch (error) {
      throw new Error(`Cannot update invalid JSON in ${configPath}`, { cause: error })
    }
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Cannot update ${configPath}: expected a JSON object`)
  }
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) {
    throw new Error(`Cannot update ${configPath}: expected "plugin" to be an array`)
  }

  const plugins = config.plugin ?? []
  const index = plugins.findIndex((entry) => specOf(entry) === TUI_PLUGIN_PATH)

  // Merge rather than replace: setting one option must not silently drop
  // another set by an earlier run, and an option left out stays as it was.
  const merged = { ...(index === -1 ? {} : optionsOf(plugins[index])), ...requested }
  const entry = Object.keys(merged).length > 0 ? [TUI_PLUGIN_PATH, merged] : TUI_PLUGIN_PATH

  const changed = index === -1 || JSON.stringify(plugins[index]) !== JSON.stringify(entry)
  const schemaAdded = config.$schema === undefined
  if (index === -1) plugins.push(entry)
  else plugins[index] = entry

  config.$schema ??= "https://opencode.ai/tui.json"
  config.plugin = plugins

  if (changed || schemaAdded || !exists) {
    const temporaryPath = `${configPath}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`)
    await rename(temporaryPath, configPath)
  }

  return { changed, configPath }
}

async function isMainModule() {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
}

/** `--narrow=hide`, `--placement sidebar`, `--layout stack`; anything else is the config dir. */
export function parseTuiPluginArgs(argv = []) {
  const options = {}
  let configDir
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const match = /^--(narrow|placement|layout)(?:=(.*))?$/.exec(argument)
    if (!match) {
      configDir ??= argument
      continue
    }
    const value = match[2] ?? argv[++index]
    if (value === undefined) throw new Error(`--${match[1]} needs a value`)
    options[match[1]] = value
  }
  return { configDir, options: validateTuiPluginOptions(options) }
}

if (await isMainModule()) {
  const { configDir, options } = parseTuiPluginArgs(process.argv.slice(2))
  const { changed, configPath } = await installTuiPlugin(configDir, options)
  console.log(`${changed ? "Configured" : "Already configured"} ${configPath}`)
}
