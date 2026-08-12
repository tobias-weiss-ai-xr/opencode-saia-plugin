import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { saiaConfigPath } from "./saia-transport.mjs"
import { setSaiaTransport } from "./set-saia-transport.mjs"

test("persists a transport choice while preserving plugin settings", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))

  try {
    await writeFile(saiaConfigPath(directory), '{"otherSetting":true}\n')
    const configPath = await setSaiaTransport("responses", directory)
    const config = JSON.parse(await readFile(configPath, "utf8"))
    assert.deepEqual(config, { otherSetting: true, transport: "responses" })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects unsupported transport choices", async () => {
  await assert.rejects(() => setSaiaTransport("unsupported"), /Transport must be either/)
})
