import assert from "node:assert/strict"
import { execFile as execFileCallback } from "node:child_process"
import { access, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { pathToFileURL } from "node:url"
import test from "node:test"
import { installRuntime } from "./install-runtime.mjs"
import { SAIA_PLUGIN_ROOT_FILES, SAIA_RUNTIME_FILES } from "./runtime-manifest.mjs"

const execFile = promisify(execFileCallback)
const SOURCE_DIR = path.join(process.cwd(), "src")

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const child = path.join(directory, entry.name)
      if (!entry.isDirectory()) return [child]
      return filesBelow(child)
    }),
  )
  return files.flat()
}

async function withTemporaryHome(run) {
  const home = await mkdtemp(path.join(tmpdir(), "saia installer home-"))
  try {
    await run(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

test("installs the explicit runtime manifest without test files and preserves settings on reinstall", async () => {
  await withTemporaryHome(async (home) => {
    const configDir = path.join(home, ".config", "opencode")
    const { targetDir, pluginRoot } = await installRuntime(SOURCE_DIR, configDir)

    for (const file of SAIA_RUNTIME_FILES) {
      assert.equal(await exists(path.join(targetDir, file)), true, `missing runtime file ${file}`)
    }
    for (const file of SAIA_PLUGIN_ROOT_FILES) {
      assert.equal(await exists(path.join(pluginRoot, file)), true, `missing entrypoint ${file}`)
    }
    assert.equal(await exists(path.join(targetDir, "provider", "ollama.sh")), true)
    assert.deepEqual(JSON.parse(await readFile(path.join(configDir, "tui.json"), "utf8")).plugin, [
      "./plugins/saia-limits-tui.tsx",
    ])
    assert.equal((await filesBelow(targetDir)).some((file) => file.endsWith(".test.mjs")), false)

    const settingsPath = path.join(configDir, "saia.json")
    await writeFile(
      settingsPath,
      JSON.stringify({
        transport: "responses",
        apiKeyCommand: ["security", "find-generic-password", "-s", "saia", "-w"],
      }),
    )
    await writeFile(path.join(targetDir, "leftover.test.mjs"), "should be removed")

    await installRuntime(SOURCE_DIR, configDir)

    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
      transport: "responses",
      apiKeyCommand: ["security", "find-generic-password", "-s", "saia", "-w"],
    })
    assert.equal(await exists(path.join(targetDir, "leftover.test.mjs")), false)
  })
})

test("the Bash installer works in a temporary home whose path contains spaces", async () => {
  await withTemporaryHome(async (home) => {
    const env = { ...process.env, HOME: home, SAIA_API_KEY: "test-key" }
    delete env.OPENCODE_CONFIG_DIR
    delete env.XDG_CONFIG_HOME

    await execFile("bash", ["install.sh", "--transport", "responses"], {
      cwd: process.cwd(),
      env,
    })

    const configDir = path.join(home, ".config", "opencode")
    const targetDir = path.join(configDir, "plugins", "saia")
    assert.equal(await exists(path.join(targetDir, "saia.ts")), true)
    assert.equal(await exists(path.join(configDir, "plugins", "saia-plugin.ts")), true)
    assert.equal(await exists(path.join(targetDir, "provider", "ollama.sh")), true)
    assert.deepEqual(JSON.parse(await readFile(path.join(configDir, "saia.json"), "utf8")), {
      transport: "responses",
    })
  })
})

test("the non-interactive wizard accepts a valid apiKeyCommand without an environment key", async () => {
  await withTemporaryHome(async (home) => {
    const configDir = path.join(home, ".config", "opencode")
    await mkdir(configDir, { recursive: true })
    await writeFile(
      path.join(configDir, "saia.json"),
      JSON.stringify({ apiKeyCommand: ["security", "find-generic-password", "-s", "saia", "-w"] }),
    )

    const env = { ...process.env, HOME: home }
    delete env.SAIA_API_KEY
    delete env.OPENCODE_CONFIG_DIR
    delete env.XDG_CONFIG_HOME
    await execFile("bash", ["src/setup-wizard.sh", "--non-interactive"], {
      cwd: process.cwd(),
      env,
    })

    assert.equal(await exists(path.join(configDir, "plugins", "saia", "saia.ts")), true)
    assert.deepEqual(JSON.parse(await readFile(path.join(configDir, "saia.json"), "utf8")), {
      apiKeyCommand: ["security", "find-generic-password", "-s", "saia", "-w"],
    })
    assert.equal(await exists(path.join(home, ".bashrc")), false)
  })
})

test("the installed server and TUI entrypoints import through the installed layout", async () => {
  await withTemporaryHome(async (home) => {
    const configDir = path.join(home, ".config", "opencode")
    const { pluginRoot } = await installRuntime(SOURCE_DIR, configDir)
    const serverURL = pathToFileURL(path.join(pluginRoot, "saia-plugin.ts")).href
    const tuiURL = pathToFileURL(path.join(pluginRoot, "saia-limits-tui.tsx")).href
    const code = `
      import server from ${JSON.stringify(serverURL)}
      import tui, { displayLimits } from ${JSON.stringify(tuiURL)}
      const hooks = await server.server({ client: { app: { async log() {} } } })
      let claim
      tui.setup({ ui: { slot(value) { claim = value } } })
      console.log(JSON.stringify({
        id: server.id,
        setup: typeof server.setup,
        config: typeof hooks.config,
        headers: typeof hooks["chat.headers"],
        slot: claim.append,
        render: typeof claim.render,
        limits: displayLimits({ minute: 1 }),
      }))
    `
    const { stdout } = await execFile(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      cwd: process.cwd(),
    })

    assert.deepEqual(JSON.parse(stdout), {
      id: "saia",
      setup: "function",
      config: "function",
      headers: "function",
      slot: "prompt.footer",
      render: "function",
      limits: "1/m",
    })
  })
})

test("the installed updater rolls back the runtime, entrypoints, and TUI registration together", async () => {
  await withTemporaryHome(async (home) => {
    const configDir = path.join(home, "custom config", "opencode")
    const { pluginRoot, targetDir } = await installRuntime(SOURCE_DIR, configDir)
    const backupDir = path.join(home, ".cache", "saia", "plugin-backups", "snapshot")
    await mkdir(backupDir, { recursive: true })
    await cp(targetDir, path.join(backupDir, "saia"), { recursive: true })
    await copyFile(path.join(pluginRoot, "saia-plugin.ts"), path.join(backupDir, "saia-plugin.ts"))
    await copyFile(path.join(pluginRoot, "saia-limits-tui.tsx"), path.join(backupDir, "saia-limits-tui.tsx"))

    const expectedRuntime = await readFile(path.join(targetDir, "saia.ts"), "utf8")
    const expectedEntrypoint = await readFile(path.join(pluginRoot, "saia-plugin.ts"), "utf8")
    await writeFile(path.join(targetDir, "saia.ts"), "changed runtime")
    await writeFile(path.join(pluginRoot, "saia-plugin.ts"), "changed entrypoint")
    await writeFile(path.join(configDir, "tui.json"), JSON.stringify({ plugin: [] }))

    await execFile("bash", [path.join(targetDir, "update-plugin.sh"), "--rollback"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, OPENCODE_CONFIG_DIR: configDir },
    })

    assert.equal(await readFile(path.join(targetDir, "saia.ts"), "utf8"), expectedRuntime)
    assert.equal(await readFile(path.join(pluginRoot, "saia-plugin.ts"), "utf8"), expectedEntrypoint)
    assert.deepEqual(JSON.parse(await readFile(path.join(configDir, "tui.json"), "utf8")).plugin, [
      "./plugins/saia-limits-tui.tsx",
    ])
  })
})

test("OpenCode 1.18.16 loads automatic and explicit installed server plugin paths", async (t) => {
  let version
  try {
    ({ stdout: version } = await execFile("opencode", ["--version"]))
  } catch {
    t.skip("OpenCode CLI is not installed")
    return
  }

  if (version.trim() !== "1.18.16") {
    t.skip(`requires OpenCode 1.18.16 (found ${version.trim() || "unknown"})`)
    return
  }

  await withTemporaryHome(async (home) => {
    const configDir = path.join(home, ".config", "opencode")
    const cacheDir = path.join(home, ".cache", "saia")
    await mkdir(cacheDir, { recursive: true })
    await writeFile(
      path.join(cacheDir, "models.json"),
      JSON.stringify({
        timestamp: Date.now(),
        data: {
          data: [
            {
              id: "smoke-model",
              name: "Smoke Model",
              input: ["text"],
              output: ["text"],
              status: "ready",
            },
          ],
        },
      }),
    )
    await installRuntime(SOURCE_DIR, configDir)

    const env = { ...process.env, HOME: home, OPENCODE_CONFIG_DIR: configDir, SAIA_API_KEY: "" }
    const { stdout, stderr } = await execFile("opencode", ["debug", "config", "--print-logs"], {
      cwd: process.cwd(),
      env,
    })
    const configStart = stdout.indexOf("\n{")
    assert.ok(configStart >= 0, `OpenCode did not print its resolved config:\n${stdout}`)

    const automaticConfig = JSON.parse(stdout.slice(configStart + 1))
    assert.equal(automaticConfig.model, "saia/smoke-model")
    assert.equal(automaticConfig.provider.saia.models["smoke-model"].name, "Smoke Model")
    assert.ok(automaticConfig.plugin.some((entry) => entry.endsWith("/plugins/saia-plugin.ts")))
    assert.ok(automaticConfig.plugin_origins.some((entry) => entry.scope === "global"))
    assert.doesNotMatch(stderr, /plugin .* (error|failed)/i)

    await rm(path.join(configDir, "plugins", "saia-plugin.ts"))
    await writeFile(path.join(configDir, "opencode.json"), JSON.stringify({ plugin: ["./plugins/saia/saia.ts"] }))
    const explicit = await execFile("opencode", ["debug", "config"], { cwd: process.cwd(), env })
    const explicitConfigStart = explicit.stdout.indexOf("\n{")
    assert.ok(explicitConfigStart >= 0, `OpenCode did not print its resolved config:\n${explicit.stdout}`)

    const explicitConfig = JSON.parse(explicit.stdout.slice(explicitConfigStart + 1))
    assert.equal(explicitConfig.model, "saia/smoke-model")
    assert.equal(explicitConfig.provider.saia.models["smoke-model"].name, "Smoke Model")
    assert.ok(explicitConfig.plugin.some((entry) => entry.endsWith("/plugins/saia/saia.ts")))
  })
})
