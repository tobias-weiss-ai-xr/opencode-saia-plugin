import assert from "node:assert/strict"
import test from "node:test"
import plugin from "./saia-plugin.ts"
import tuiPlugin, { displayLimits } from "./saia-limits-tui.tsx"

test("server plugin exports the dual V1+V2 definition", async () => {
  assert.equal(plugin.id, "saia")
  assert.equal(typeof plugin.setup, "function")
  assert.equal(typeof plugin.server, "function")

  // V1 path: opencode < 2 calls server({ client }) and gets the V1 hook set.
  const hooks = await plugin.server({
    client: {
      app: {
        async log() {},
      },
    },
  })

  assert.equal(typeof hooks.config, "function")
  assert.equal(typeof hooks["chat.headers"], "function")
  assert.equal(typeof hooks["experimental.chat.system.transform"], "function")
})

test("formats quota labels and registers the TUI prompt footer slot", async () => {
  const limits = { minute: "26", hour: "128", day: "530", month: "2500" }

  assert.equal(
    displayLimits({ minute: "9", hour: "199", day: null, month: "2998" }),
    "9/m · 199/h · 3k/mo",
  )
  assert.equal(displayLimits(limits), "26/m · 128/h · 530/d · 2.5k/mo")
  assert.equal(displayLimits({}), "")

  let claim
  const ctx = {
    ui: {
      slot(input) {
        claim = input
      },
    },
    data: {
      session: {
        get() {
          return { metadata: { saiaLimits: limits } }
        },
      },
    },
    theme: { text: { muted: "#808080" } },
  }

  // v2 TUI shape: { id, setup(ctx) } claiming "prompt.footer".
  assert.equal(tuiPlugin.id, "saia-limits-tui")
  assert.equal(typeof tuiPlugin.setup, "function")

  tuiPlugin.setup(ctx)
  assert.equal(claim.append, "prompt.footer")
  assert.equal(typeof claim.render, "function")

  // Never throws when loaded by a non-TUI host (no slot tree at all).
  tuiPlugin.setup({})
  tuiPlugin.setup(undefined)

  // V1 registration still works: tui.tui(api) registers session_prompt_right.
  let registered
  await tuiPlugin.tui({
    state: {
      session: {
        get() {
          return { metadata: { saiaLimits: limits } }
        },
      },
    },
    theme: { current: { textMuted: "#808080" } },
    slots: {
      register(value) {
        registered = value
      },
    },
  })

  assert.equal(registered.order, 100)
  assert.equal(typeof registered.slots.session_prompt_right, "function")
})
