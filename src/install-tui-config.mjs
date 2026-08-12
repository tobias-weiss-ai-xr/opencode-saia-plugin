import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const TUI_PLUGIN_PATH = "./plugins/saia-limits-tui.tsx"

function hasPlugin(entries) {
  return entries.some((entry) => entry === TUI_PLUGIN_PATH)
}

async function fileExists(file) {
  try {
    await access(file, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function installTuiPlugin(configDir = path.join(homedir(), ".config", "opencode")) {
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
  const changed = !hasPlugin(plugins)
  const schemaAdded = config.$schema === undefined
  if (changed) plugins.push(TUI_PLUGIN_PATH)

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

if (await isMainModule()) {
  const { changed, configPath } = await installTuiPlugin(process.argv[2])
  console.log(`${changed ? "Configured" : "Already configured"} ${configPath}`)
}
