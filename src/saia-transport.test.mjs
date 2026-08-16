import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import {
  DEFAULT_SAIA_BASE_URL,
  DEFAULT_SAIA_TRANSPORT,
  resolveSaiaBaseURL,
  resolveSaiaTransport,
  saiaConfigPath,
} from "./saia-transport.mjs"
import { defaultSaiaConfigDir } from "./saia-settings.mjs"

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

test("baseURL falls back to the default when none is configured", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))

  try {
    assert.equal(await resolveSaiaBaseURL({ configDir: directory }), DEFAULT_SAIA_BASE_URL)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("a configured baseURL is honoured independently of transport", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))

  try {
    await writeFile(
      saiaConfigPath(directory),
      '{"transport":"chat-completions","baseURL":"https://saia.invalid/v1/"}\n',
    )
    const transport = await resolveSaiaTransport({ configDir: directory, environment: {} })

    // The transport still picks the npm package; the host is a separate choice.
    assert.equal(transport.npm, "@ai-sdk/openai-compatible")
    // A trailing slash would otherwise produce a doubled "//models" on discovery.
    assert.equal(await resolveSaiaBaseURL({ configDir: directory }), "https://saia.invalid/v1")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("an unusable baseURL warns and falls back to the default", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))
  const warnings = []

  try {
    await writeFile(saiaConfigPath(directory), '{"baseURL":"not-a-url"}\n')
    const resolved = await resolveSaiaBaseURL({
      configDir: directory,
      onWarning: (message) => warnings.push(message),
    })

    assert.equal(resolved, DEFAULT_SAIA_BASE_URL)
    assert.match(warnings.join("\n"), /Ignoring unusable baseURL "not-a-url"/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the config dir follows install.sh's precedence rule", () => {
  // OPENCODE_CONFIG_DIR wins outright, and is used verbatim.
  assert.equal(
    defaultSaiaConfigDir({ OPENCODE_CONFIG_DIR: "/explicit", XDG_CONFIG_HOME: "/xdg" }),
    "/explicit",
  )
  // Then XDG_CONFIG_HOME, with the "opencode" suffix appended.
  assert.equal(defaultSaiaConfigDir({ XDG_CONFIG_HOME: "/xdg" }), path.join("/xdg", "opencode"))
  // Otherwise ~/.config/opencode.
  assert.ok(defaultSaiaConfigDir({}).endsWith(path.join(".config", "opencode")))
})
