import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function saiaConfigPath(configDir = path.join(homedir(), ".config", "opencode")) {
  return path.join(configDir, "saia.json")
}

export async function readSaiaSettings({
  configDir,
  onWarning = console.warn,
} = {}) {
  const configPath = saiaConfigPath(configDir)

  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8"))
    if (!isRecord(parsed)) {
      onWarning(`[SAIA] Could not read ${configPath}: expected a JSON object`)
      return {}
    }
    return parsed
  } catch (error) {
    if (error?.code !== "ENOENT") {
      onWarning(
        `[SAIA] Could not read ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return {}
  }
}

export async function updateSaiaSettings(update, configDir) {
  await mkdir(configDir ?? path.dirname(saiaConfigPath()), { recursive: true })
  const configPath = saiaConfigPath(configDir)
  let settings = {}

  try {
    settings = JSON.parse(await readFile(configPath, "utf8"))
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Cannot update invalid JSON in ${configPath}`, { cause: error })
    }
  }

  if (!isRecord(settings)) {
    throw new Error(`Cannot update ${configPath}: expected a JSON object`)
  }

  const updated = await update({ ...settings })
  if (!isRecord(updated)) {
    throw new Error(`Cannot update ${configPath}: expected a JSON object`)
  }

  const temporaryPath = `${configPath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`)
  await rename(temporaryPath, configPath)
  return { configPath, settings: updated }
}

export function managedModelsFromSettings(settings) {
  if (!isRecord(settings?.managedModels)) return {}

  return Object.fromEntries(
    Object.entries(settings.managedModels).filter(([, model]) => isRecord(model)),
  )
}
