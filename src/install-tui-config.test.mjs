import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { installTuiPlugin, TUI_PLUGIN_PATH } from "./install-tui-config.mjs"

test("creates a TUI configuration when none exists", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))
  const configPath = path.join(directory, "tui.json")

  try {
    const result = await installTuiPlugin(directory)
    const config = JSON.parse(await readFile(configPath, "utf8"))

    assert.equal(result.changed, true)
    assert.equal(config.$schema, "https://opencode.ai/tui.json")
    assert.deepEqual(config.plugin, [TUI_PLUGIN_PATH])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("adds the SAIA TUI plugin without replacing configured plugins", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))
  const configPath = path.join(directory, "tui.json")

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        $schema: "https://opencode.ai/tui.json",
        theme: "my-theme",
        plugin: ["./plugins/existing.tsx"],
      }),
    )

    const result = await installTuiPlugin(directory)
    const config = JSON.parse(await readFile(configPath, "utf8"))

    assert.equal(result.changed, true)
    assert.deepEqual(config.plugin, ["./plugins/existing.tsx", TUI_PLUGIN_PATH])
    assert.equal(config.theme, "my-theme")

    const second = await installTuiPlugin(directory)
    assert.equal(second.changed, false)
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")).plugin, [
      "./plugins/existing.tsx",
      TUI_PLUGIN_PATH,
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("configures OpenCode 2.x cli.json alongside the V1 tui.json", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))
  const cliPath = path.join(directory, "cli.json")

  try {
    await writeFile(cliPath, JSON.stringify({ keybinds: { "app.quit": ["ctrl+c"] } }))

    const result = await installTuiPlugin(directory)
    const cli = JSON.parse(await readFile(cliPath, "utf8"))

    assert.equal(result.cliChanged, true)
    assert.equal(result.cliConfigPath, cliPath)
    assert.deepEqual(cli.plugins, [TUI_PLUGIN_PATH])
    assert.equal(cli.$schema, undefined) // never invents a schema for user-managed files
    assert.equal(cli.keybinds["app.quit"][0], "ctrl+c")

    const second = await installTuiPlugin(directory)
    assert.equal(second.cliChanged, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects a malformed cli.json plugins array", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))
  const cliPath = path.join(directory, "cli.json")

  try {
    await writeFile(cliPath, JSON.stringify({ plugins: "not-an-array" }))

    await assert.rejects(() => installTuiPlugin(directory), /expected "plugins" to be an array/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
