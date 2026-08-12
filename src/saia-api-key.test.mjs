import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  commandInvocation,
  isSaiaApiKeyCommand,
  resolveSaiaApiKey,
  resetSaiaApiKeyCache,
} from "./saia-api-key.mjs"

async function withConfig(config, run) {
  const dir = await mkdtemp(path.join(tmpdir(), "saia-api-key-"))
  try {
    if (config !== undefined) {
      await writeFile(path.join(dir, "saia.json"), JSON.stringify(config))
    }
    resetSaiaApiKeyCache()
    return await run(dir)
  } finally {
    resetSaiaApiKeyCache()
    await rm(dir, { recursive: true, force: true })
  }
}

test("prefers an already-exported SAIA_API_KEY", async () => {
  await withConfig({ apiKeyCommand: ["/bin/echo", "from-command"] }, async (configDir) => {
    const key = await resolveSaiaApiKey({ configDir, environment: { SAIA_API_KEY: "from-env" } })
    assert.equal(key, "from-env")
  })
})

test("runs an argv apiKeyCommand without a shell", async () => {
  await withConfig({ apiKeyCommand: ["/bin/echo", "secret-token"] }, async (configDir) => {
    const key = await resolveSaiaApiKey({ configDir, environment: {} })
    assert.equal(key, "secret-token")
  })
})

test("runs a string apiKeyCommand through a shell", async () => {
  await withConfig({ apiKeyCommand: "printf 'shell-token'" }, async (configDir) => {
    const key = await resolveSaiaApiKey({ configDir, environment: {} })
    assert.equal(key, "shell-token")
  })
})

test("uses a platform-appropriate shell invocation for string commands", () => {
  assert.deepEqual(commandInvocation("printf token", "darwin"), {
    file: "/bin/sh",
    arguments: ["-c", "printf token"],
  })
  assert.deepEqual(commandInvocation("Write-Output token", "win32"), {
    file: "cmd.exe",
    arguments: ["/d", "/s", "/c", "Write-Output token"],
  })
})

test("validates helper commands before attempting to execute them", async () => {
  assert.equal(isSaiaApiKeyCommand(" "), false)
  assert.equal(isSaiaApiKeyCommand([]), false)
  assert.equal(isSaiaApiKeyCommand([""]), false)
  assert.equal(isSaiaApiKeyCommand(["echo", 1]), false)
  assert.equal(isSaiaApiKeyCommand(["echo", "token"]), true)

  await withConfig({ apiKeyCommand: ["echo", 1] }, async (configDir) => {
    const warnings = []
    const key = await resolveSaiaApiKey({ configDir, environment: {}, onWarning: (m) => warnings.push(m) })

    assert.equal(key, undefined)
    assert.deepEqual(warnings, [
      "[SAIA] Ignoring invalid apiKeyCommand: expected a non-empty string or string array",
    ])
  })
})

test("trims trailing newlines that helpers normally emit", async () => {
  await withConfig({ apiKeyCommand: ["/bin/echo", "  padded-token  "] }, async (configDir) => {
    const key = await resolveSaiaApiKey({ configDir, environment: {} })
    assert.equal(key, "padded-token")
  })
})

test("returns nothing when no key source is configured", async () => {
  await withConfig(undefined, async (configDir) => {
    const warnings = []
    const key = await resolveSaiaApiKey({ configDir, environment: {}, onWarning: (m) => warnings.push(m) })
    assert.equal(key, undefined)
    assert.deepEqual(warnings, [], "a missing saia.json is normal and must stay quiet")
  })
})

test("warns without leaking output when the command fails", async () => {
  await withConfig({ apiKeyCommand: ["/bin/sh", "-c", "echo the-secret; exit 3"] }, async (configDir) => {
    const warnings = []
    const key = await resolveSaiaApiKey({ configDir, environment: {}, onWarning: (m) => warnings.push(m) })
    assert.equal(key, undefined)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /apiKeyCommand failed/)
    assert.ok(!warnings[0].includes("the-secret"), "the warning must not echo command output")
  })
})

test("warns when the command succeeds but produces nothing", async () => {
  await withConfig({ apiKeyCommand: ["/bin/echo", "-n", ""] }, async (configDir) => {
    const warnings = []
    const key = await resolveSaiaApiKey({ configDir, environment: {}, onWarning: (m) => warnings.push(m) })
    assert.equal(key, undefined)
    assert.match(warnings[0], /produced no output/)
  })
})

test("runs the command once per process and reuses the result", async () => {
  const marker = path.join(await mkdtemp(path.join(tmpdir(), "saia-api-key-count-")), "runs")
  await withConfig({ apiKeyCommand: `echo run >> ${marker}; printf 'cached-token'` }, async (configDir) => {
    const first = await resolveSaiaApiKey({ configDir, environment: {} })
    const second = await resolveSaiaApiKey({ configDir, environment: {} })
    assert.equal(first, "cached-token")
    assert.equal(second, "cached-token")

    const { readFile } = await import("node:fs/promises")
    const runs = (await readFile(marker, "utf8")).trim().split("\n").length
    assert.equal(runs, 1, "a keychain helper may prompt, so it must not run twice")
  })
})
