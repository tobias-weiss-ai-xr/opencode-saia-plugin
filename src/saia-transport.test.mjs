import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { DEFAULT_SAIA_TRANSPORT, resolveSaiaTransport, saiaConfigPath } from "./saia-transport.mjs"

test("defaults to Chat Completions when no transport is configured", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))

  try {
    const transport = await resolveSaiaTransport({ configDir: directory, environment: {} })
    assert.equal(transport.id, DEFAULT_SAIA_TRANSPORT)
    assert.equal(transport.npm, "@ai-sdk/openai-compatible")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("uses the persistent transport selection when present", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))

  try {
    await writeFile(saiaConfigPath(directory), '{"transport":"responses"}\n')
    const transport = await resolveSaiaTransport({ configDir: directory, environment: {} })
    assert.equal(transport.id, "responses")
    assert.equal(transport.npm, "@ai-sdk/openai")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("environment transport selection overrides the persistent setting", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))

  try {
    await writeFile(saiaConfigPath(directory), '{"transport":"responses"}\n')
    const transport = await resolveSaiaTransport({
      configDir: directory,
      environment: { SAIA_API_TRANSPORT: "chat-completions" },
    })
    assert.equal(transport.id, "chat-completions")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("invalid transport selections fall back to the default", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))
  const warnings = []

  try {
    await writeFile(saiaConfigPath(directory), '{"transport":"invalid"}\n')
    const transport = await resolveSaiaTransport({
      configDir: directory,
      environment: {},
      onWarning: (message) => warnings.push(message),
    })
    assert.equal(transport.id, DEFAULT_SAIA_TRANSPORT)
    assert.equal(warnings.length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
