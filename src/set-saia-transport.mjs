import { realpath } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { isSaiaTransport } from "./saia-transport.mjs"
import { updateSaiaSettings } from "./saia-settings.mjs"

export async function setSaiaTransport(transport, configDir = path.join(homedir(), ".config", "opencode")) {
  if (!isSaiaTransport(transport)) {
    throw new Error('Transport must be either "chat-completions" or "responses".')
  }

  const { configPath } = await updateSaiaSettings((config) => ({ ...config, transport }), configDir)
  return configPath
}

async function isMainModule() {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
}

if (await isMainModule()) {
  const [transport, configDir] = process.argv.slice(2)

  try {
    const configPath = await setSaiaTransport(transport, configDir)
    console.log(`SAIA transport set to ${transport} in ${configPath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
