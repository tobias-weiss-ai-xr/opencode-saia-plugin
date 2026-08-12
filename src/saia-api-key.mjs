import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import { saiaConfigPath } from "./saia-settings.mjs"

const run = promisify(execFile)

// A key helper may prompt (Keychain ACL, hardware token), so cap the wait rather than
// letting OpenCode's startup hang on it.
const COMMAND_TIMEOUT_MS = 10_000

// Resolving can shell out, and both the model refresh and the config hook need the key.
// Memoise per process so the helper runs at most once per OpenCode session.
let pending

export function isSaiaApiKeyCommand(value) {
  if (typeof value === "string") return value.trim().length > 0
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "string" &&
    value[0].trim().length > 0 &&
    value.every((argument) => typeof argument === "string")
  )
}

export function commandInvocation(command, platform = process.platform) {
  if (!isSaiaApiKeyCommand(command)) return
  if (Array.isArray(command)) {
    return { file: command[0], arguments: command.slice(1) }
  }

  return platform === "win32"
    ? { file: "cmd.exe", arguments: ["/d", "/s", "/c", command] }
    : { file: "/bin/sh", arguments: ["-c", command] }
}

async function readKeyCommand(configDir, onWarning) {
  try {
    const config = JSON.parse(await readFile(saiaConfigPath(configDir), "utf8"))
    const command = config?.apiKeyCommand
    if (command === undefined) return
    if (isSaiaApiKeyCommand(command)) return command

    onWarning("[SAIA] Ignoring invalid apiKeyCommand: expected a non-empty string or string array")
  } catch (error) {
    if (error?.code !== "ENOENT") {
      onWarning(`[SAIA] Could not read ${saiaConfigPath(configDir)}: ${error.message}`)
    }
  }
}

async function runKeyCommand(command, onWarning) {
  try {
    const invocation = commandInvocation(command)
    if (!invocation) return

    const { stdout } = await run(invocation.file, invocation.arguments, {
      timeout: COMMAND_TIMEOUT_MS,
    })

    const key = stdout.trim()
    if (key) return key
    onWarning("[SAIA] apiKeyCommand produced no output")
  } catch (error) {
    // Report only the exit status. Node puts the command's own stdout into
    // error.message, which is the secret whenever the helper prints it and then fails.
    const reason = error?.killed
      ? `timed out after ${COMMAND_TIMEOUT_MS}ms`
      : error?.code !== undefined
        ? `exit code ${error.code}`
        : "could not be started"
    onWarning(`[SAIA] apiKeyCommand failed: ${reason}`)
  }
}

/**
 * Resolves the SAIA key without ever placing it in the environment or on disk:
 * SAIA_API_KEY if the caller already exported one, otherwise the apiKeyCommand
 * configured in saia.json.
 */
export async function resolveSaiaApiKey({
  configDir,
  environment = process.env,
  onWarning = console.warn,
  force = false,
} = {}) {
  if (environment.SAIA_API_KEY) return environment.SAIA_API_KEY
  if (pending && !force) return pending

  pending = (async () => {
    const command = await readKeyCommand(configDir, onWarning)
    if (!command) return undefined
    return runKeyCommand(command, onWarning)
  })()

  return pending
}

export function resetSaiaApiKeyCache() {
  pending = undefined
}
