import assert from "node:assert/strict"
import test from "node:test"
import { normalizeSaiaQwenSystemMessages, normalizeSaiaQwenSystemParts } from "./saia-system-messages.js"

test("merges SAIA Qwen 3.5 system messages into one leading message", () => {
  const system = ["OpenCode instructions", "Project instructions", "User instructions"]

  normalizeSaiaQwenSystemMessages({ providerID: "saia", id: "qwen3.5-122b-a10b" }, system)

  assert.deepEqual(system, ["OpenCode instructions\n\nProject instructions\n\nUser instructions"])
})

test("merges SAIA Qwen 3.6 system messages and ignores blank fragments", () => {
  const system = ["OpenCode instructions", "", "Project instructions"]

  normalizeSaiaQwenSystemMessages({ providerID: "saia", id: "qwen3.6-35b-a3b" }, system)

  assert.deepEqual(system, ["OpenCode instructions\n\nProject instructions"])
})

test("does not modify models without SAIA's strict Qwen system-message constraint", () => {
  const coderSystem = ["OpenCode instructions", "Project instructions"]
  const otherProviderSystem = ["OpenCode instructions", "Project instructions"]

  normalizeSaiaQwenSystemMessages({ providerID: "saia", id: "qwen3-coder-next" }, coderSystem)
  normalizeSaiaQwenSystemMessages({ providerID: "other", id: "qwen3.5-122b-a10b" }, otherProviderSystem)

  assert.deepEqual(coderSystem, ["OpenCode instructions", "Project instructions"])
  assert.deepEqual(otherProviderSystem, ["OpenCode instructions", "Project instructions"])
})

test("merges v2 text system parts for SAIA Qwen models", () => {
  const system = [
    { type: "text", text: "OpenCode instructions" },
    { type: "text", text: "" },
    { type: "text", text: "Project instructions" },
  ]

  normalizeSaiaQwenSystemParts({ providerID: "saia", id: "qwen3.5-122b-a10b" }, system)

  assert.deepEqual(system, [{ type: "text", text: "OpenCode instructions\n\nProject instructions" }])
})

test("leaves non-text v2 system parts and short lists untouched", () => {
  const mixed = [
    { type: "text", text: "One" },
    { type: "resource", uri: "file:///tmp" },
  ]
  const single = [{ type: "text", text: "One" }]

  normalizeSaiaQwenSystemParts({ providerID: "saia", id: "qwen3.5-122b-a10b" }, mixed)
  normalizeSaiaQwenSystemParts({ providerID: "saia", id: "qwen3.5-122b-a10b" }, single)
  normalizeSaiaQwenSystemParts({ providerID: "saia", id: "glm-5.3-flash" }, [
    { type: "text", text: "One" },
    { type: "text", text: "Two" },
  ])

  assert.deepEqual(mixed, [
    { type: "text", text: "One" },
    { type: "resource", uri: "file:///tmp" },
  ])
  assert.deepEqual(single, [{ type: "text", text: "One" }])
})
