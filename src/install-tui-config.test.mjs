import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { installTuiPlugin, parseTuiPluginArgs, TUI_PLUGIN_PATH, validateTuiPluginOptions } from "./install-tui-config.mjs"

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

test("stores widget options as a plugin tuple and merges later runs", async (t) => {
  const configDir = await mkdtemp(path.join(tmpdir(), "saia-tui-options-"))
  t.after(() => rm(configDir, { recursive: true, force: true }))
  const configPath = path.join(configDir, "tui.json")
  const read = async () => JSON.parse(await readFile(configPath, "utf8"))

  await installTuiPlugin(configDir, { placement: "prompt" })
  assert.deepEqual((await read()).plugin, [[TUI_PLUGIN_PATH, { placement: "prompt" }]])

  // Setting one option must not silently drop the other.
  await installTuiPlugin(configDir, { narrow: "hide" })
  assert.deepEqual((await read()).plugin, [[TUI_PLUGIN_PATH, { placement: "prompt", narrow: "hide" }]])

  // An option left out stays as it was, and the entry is never duplicated.
  await installTuiPlugin(configDir)
  const plugins = (await read()).plugin
  assert.equal(plugins.length, 1)
  assert.deepEqual(plugins, [[TUI_PLUGIN_PATH, { placement: "prompt", narrow: "hide" }]])
})

test("upgrades an existing plain string entry in place", async (t) => {
  const configDir = await mkdtemp(path.join(tmpdir(), "saia-tui-upgrade-"))
  t.after(() => rm(configDir, { recursive: true, force: true }))
  const configPath = path.join(configDir, "tui.json")

  await installTuiPlugin(configDir)
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")).plugin, [TUI_PLUGIN_PATH])

  await installTuiPlugin(configDir, { placement: "sidebar" })
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")).plugin, [
    [TUI_PLUGIN_PATH, { placement: "sidebar" }],
  ])
})

test("refuses an option or a value it does not know", () => {
  assert.throws(() => validateTuiPluginOptions({ placement: "floating" }), /Invalid "placement"/)
  assert.throws(() => validateTuiPluginOptions({ narrow: "sometimes" }), /Invalid "narrow"/)
  assert.throws(() => validateTuiPluginOptions({ colour: "red" }), /Unknown TUI plugin option/)
  assert.deepEqual(validateTuiPluginOptions({ narrow: "hide", placement: "auto" }), {
    narrow: "hide",
    placement: "auto",
  })
})

test("parses the CLI forms of both flags alongside a config dir", () => {
  assert.deepEqual(parseTuiPluginArgs(["--placement=sidebar"]), {
    configDir: undefined,
    options: { placement: "sidebar" },
  })
  assert.deepEqual(parseTuiPluginArgs(["/tmp/cfg", "--narrow", "hide"]), {
    configDir: "/tmp/cfg",
    options: { narrow: "hide" },
  })
  assert.deepEqual(parseTuiPluginArgs([]), { configDir: undefined, options: {} })
  assert.throws(() => parseTuiPluginArgs(["--narrow"]), /--narrow needs a value/)
  assert.throws(() => parseTuiPluginArgs(["--placement", "floating"]), /Invalid "placement"/)
})
