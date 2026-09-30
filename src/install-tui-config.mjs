import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const TUI_PLUGIN_PATH = "./plugins/saia-limits-tui.tsx"

// OpenCode 1.x reads the TUI plugin list from tui.json ("plugin" array).
// OpenCode 2.x reads cli.json ("plugins" array). Both are maintained so the
// install works under either major version.
const TUI_CONFIGS = Object.freeze([
  { file: "tui.json", key: "plugin", schema: "https://opencode.ai/tui.json" },
  { file: "cli.json", key: "plugins", schema: undefined },
])

async function fileExists(file) {
  try {
    await access(file, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function upsertPluginEntry(configDir, { file, key, schema }) {
  const configPath = path.join(configDir, file)
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
  if (config[key] !== undefined && !Array.isArray(config[key])) {
    throw new Error(`Cannot update ${configPath}: expected "${key}" to be an array`)
  }

  const plugins = config[key] ?? []
  const changed = !plugins.includes(TUI_PLUGIN_PATH)
  if (changed) plugins.push(TUI_PLUGIN_PATH)

  config[key] = plugins
  const schemaAdded = schema !== undefined && config.$schema === undefined
  if (schemaAdded) config.$schema = schema

  if (changed || schemaAdded || !exists) {
    const temporaryPath = `${configPath}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`)
    await rename(temporaryPath, configPath)
  }

  return { changed, configPath }
}

export async function installTuiPlugin(configDir = path.join(homedir(), ".config", "opencode")) {
  await mkdir(configDir, { recursive: true })

  const results = await Promise.all(TUI_CONFIGS.map((entry) => upsertPluginEntry(configDir, entry)))

  return {
    changed: results.some((result) => result.changed),
    configPath: results[0].configPath,
    cliChanged: results[1].changed,
    cliConfigPath: results[1].configPath,
  }
}

async function isMainModule() {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
}

if (await isMainModule()) {
  const { changed, configPath, cliChanged, cliConfigPath } = await installTuiPlugin(process.argv[2])
  console.log(`${changed ? "Configured" : "Already configured"} ${configPath}`)
  console.log(`${cliChanged ? "Configured" : "Already configured"} ${cliConfigPath}`)
}
