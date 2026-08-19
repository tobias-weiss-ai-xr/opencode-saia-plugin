import assert from "node:assert/strict"
import test from "node:test"
import plugin from "./saia-plugin.ts"
import tuiPlugin, { displayLimits } from "./saia-limits-tui.tsx"

test("loads the source server wrapper and initializes its hooks", async () => {
  const hooks = await plugin({
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

test("formats quota labels and registers the TUI prompt slot", async () => {
  const limits = { minute: "26", hour: "128", day: "530", month: "2500" }

  assert.equal(
    displayLimits({ minute: "9", hour: "199", day: null, month: "2998" }),
    "9/m · 199/h · 3k/mo",
  )
  assert.equal(displayLimits(limits), "26/m · 128/h · 530/d · 2.5k/mo")
  assert.equal(displayLimits({}), "")

  const registered = []
  await tuiPlugin.tui({
    slots: {
      register(plugin) {
        registered.push(plugin)
      },
    },
  })

  assert.equal(registered[0].order, 100)
  assert.equal(typeof registered[0].slots.session_prompt_right, "function")
  assert.equal(registered[1].order, 140)
  assert.equal(typeof registered[1].slots.sidebar_content, "function")
})
