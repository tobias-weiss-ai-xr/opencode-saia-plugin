import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_NARROW,
  displayLimits,
  displayWidth,
  isActiveProvider,
  limitFields,
  normaliseNarrow,
  renderLimits,
  selectTier,
  sidebarLines,
  tiers,
  usesSidebar,
  widgetBudget,
} from "./saia-limits-tui.tsx"
import plugin from "./saia-limits-tui.tsx"

/** What the live gateway reports on a fresh account. */
const LIMITS = { minute: 9, hour: 199, day: 128, month: 2_700 }

const saia = { role: "assistant", providerID: "saia", time: { created: 0, completed: 1_000 } }
const other = { role: "assistant", providerID: "kiconnect", time: { created: 0, completed: 2_000 } }

test("formats the remaining limits the server half stored", () => {
  assert.equal(displayLimits({ minute: 8, hour: 1_200 }), "8/m · 1.2k/h")
  assert.equal(displayLimits({ minute: null, hour: "", day: 3, month: 40_000 }), "3/d · 40k/mo")
  assert.equal(displayLimits({}), "")
  assert.equal(displayLimits(null), "")
  assert.equal(displayLimits("nonsense"), "")
})

test("draws only while SAIA is the provider that answered last", () => {
  assert.equal(isActiveProvider([other, saia]), true)
  assert.equal(isActiveProvider([saia, other]), false, "a session that moved to another provider must go quiet")
  assert.equal(isActiveProvider([saia, { role: "user" }]), true, "a user message does not answer anything")
})

test("waits for a turn to complete before handing the display over", () => {
  // An in-flight turn carries no answer yet, so the last completed one still
  // decides. Otherwise the widget would blank the moment a request started.
  assert.equal(isActiveProvider([saia, { role: "assistant", providerID: "kiconnect", time: { created: 9_000 } }]), true)
  assert.equal(isActiveProvider([other, { role: "assistant", providerID: "saia", time: { created: 9_000 } }]), false)
})

test("says no rather than guessing when there is nothing to read", () => {
  assert.equal(isActiveProvider([]), false)
  assert.equal(isActiveProvider(undefined), false)
  assert.equal(isActiveProvider([{ role: "user" }]), false)
  assert.equal(isActiveProvider([{ role: "assistant", time: { completed: 1 } }]), false, "an unlabelled turn is not SAIA's")
})

test("takes the provider id as an argument, so the rule is reusable", () => {
  assert.equal(isActiveProvider([saia, other], "kiconnect"), true)
  assert.equal(isActiveProvider([other, saia], "kiconnect"), false)
})

/* -- Narrow prompt rows ----------------------------------------------------- */

test("gives up the longest window first, because the minute is what bites", () => {
  assert.deepEqual(tiers(LIMITS), [
    "9/m · 199/h · 128/d · 2.7k/mo",
    "9/m · 199/h · 128/d",
    "9/m · 199/h",
    "9/m",
  ])
  assert.deepEqual(tiers({}), [])
  assert.deepEqual(tiers(null), [])
})

test("steps down a tier as the terminal narrows", () => {
  const at = (width) => renderLimits(LIMITS, { width })
  assert.equal(at(140), "9/m · 199/h · 128/d · 2.7k/mo")
  assert.equal(at(120), "9/m · 199/h · 128/d")
  assert.equal(at(100), "9/m · 199/h")
  assert.equal(at(92), "9/m")
  // Past the last tier the two narrow modes part company.
  assert.equal(renderLimits(LIMITS, { width: 76, narrow: "hide" }), "")
  assert.equal(at(76), "9/m", "the default keeps the number that matters")
})

test("keeps the narrowest tier when nothing fits, unless told to hide", () => {
  for (const width of [76, 65, 40, 4]) {
    assert.equal(renderLimits(LIMITS, { width }), "9/m", `${width} columns, default`)
    assert.equal(renderLimits(LIMITS, { width, narrow: "hide" }), "", `${width} columns, hide`)
  }
  // No limits stored means nothing shown, in either mode.
  assert.equal(renderLimits(undefined, { width: 200 }), "")
  assert.equal(renderLimits({}, { width: 200 }), "")
})

test("reserves the columns the prompt row actually spends", () => {
  assert.equal(widgetBudget(110, 2), 19)
  assert.equal(widgetBudget(120), 24)
  assert.equal(widgetBudget(120, 3), 16)
  assert.equal(widgetBudget(72), 0)
  assert.equal(widgetBudget("nonsense"), 0)
})

test("normalises a narrow mode, falling back rather than trusting input", () => {
  assert.equal(DEFAULT_NARROW, "always")
  assert.equal(normaliseNarrow("hide"), "hide")
  assert.equal(normaliseNarrow(undefined), "always")
  assert.equal(normaliseNarrow("nonsense"), "always")
  assert.equal(normaliseNarrow(undefined, "hide"), "hide")
  assert.equal(normaliseNarrow("nonsense", "hide"), "hide")
})

test("floors only when asked, so selectTier stays honest by default", () => {
  assert.equal(selectTier(["wide enough", "short"], 3), "")
  assert.equal(selectTier(["wide enough", "short"], 3, { floor: true }), "short")
  assert.equal(selectTier(["", ""], 0, { floor: true }), "")
})

test("measures the single-width glyphs this widget emits", () => {
  assert.equal(displayWidth("9/m"), 3)
  assert.equal(displayWidth("9/m · 199/h"), 11)
  assert.equal(displayWidth(undefined), 0)
})

/* -- Placement -------------------------------------------------------------- */

test("gives the sidebar the display exactly when the host would show it", () => {
  // The host's rule: a 42-column sidebar, auto above 120 columns, force-hidden
  // in a subagent session.
  assert.equal(usesSidebar(121, {}), true)
  assert.equal(usesSidebar(120, {}), false, "120 is not wider than 120")
  assert.equal(usesSidebar(200, { parentID: "ses_parent" }), false, "a subagent session has no sidebar")
  assert.equal(usesSidebar(200, undefined), true)
  assert.equal(usesSidebar(undefined, {}), false)
  assert.equal(usesSidebar("nonsense", {}), false)
})

test("the sidebar renderer returns lines and the prompt renderer one string", () => {
  const lines = sidebarLines(LIMITS)
  assert.deepEqual(lines, ["SAIA", "9/m · 199/h · 128/d · 2.7k/mo"])
  for (const line of lines) {
    assert.ok(displayWidth(line) <= 36, `"${line}" must fit the sidebar's 36 columns`)
  }
  assert.equal(typeof renderLimits(LIMITS, { width: 120 }), "string")

  assert.deepEqual(sidebarLines({}), [])
  assert.deepEqual(sidebarLines(null), [])
})

test("wraps the sidebar block onto more rows rather than truncating a window", () => {
  assert.deepEqual(sidebarLines(LIMITS, 14), ["SAIA", "9/m · 199/h", "128/d", "2.7k/mo"])
  // A single window wider than the budget still gets its own row: dropping it
  // silently would be worse than one clipped line.
  assert.deepEqual(sidebarLines({ minute: 9, hour: 199 }, 2), ["SAIA", "9/m", "199/h"])
})

test("lists only the windows the metadata actually carries", () => {
  assert.deepEqual(limitFields({ minute: 8, hour: 1_200 }), ["8/m", "1.2k/h"])
  assert.deepEqual(limitFields({ minute: null, hour: "", day: 3 }), ["3/d"])
  assert.deepEqual(limitFields("nonsense"), [])
})

/* -- Registration ----------------------------------------------------------- */

/**
 * The minimum api surface `tui()` touches. Everything optional is deliberately
 * absent, so a plugin that stops guarding an optional call fails here rather
 * than at the user's first keystroke.
 */
function stubApi(overrides = {}) {
  return {
    kv: { get: () => undefined, set: () => {} },
    keymap: { registerLayer: () => () => {} },
    ui: { toast: () => {} },
    renderer: { width: 200 },
    theme: { current: { text: "#fff", textMuted: "#aaa" } },
    state: { session: { get: () => undefined, messages: () => [] } },
    slots: { register: () => "saia-limits-tui" },
    ...overrides,
  }
}

test("registers both slots, so the block moves rather than appearing twice", async () => {
  let registered
  await plugin.tui(stubApi({ slots: { register: (value) => (registered = value) } }))

  assert.equal(registered.order, 100, "first in the strip and first in the sidebar stack")
  assert.equal(typeof registered.slots.session_prompt_right, "function")
  assert.equal(typeof registered.slots.sidebar_content, "function")
})

test("survives a host without the optional apis it uses", async () => {
  // kv, keymap and ui are all conveniences: losing the toggle is survivable,
  // losing the widget is not.
  const bare = stubApi({ kv: undefined, keymap: undefined, ui: undefined })
  let registered
  bare.slots = { register: (value) => (registered = value) }
  await plugin.tui(bare)
  assert.equal(typeof registered.slots.sidebar_content, "function")
})

test("registers a command for the narrow-terminal toggle", async () => {
  let layer
  await plugin.tui(stubApi({ keymap: { registerLayer: (value) => (layer = value) } }))

  const command = layer.commands.find((item) => item.slashName === "saia-limits-narrow")
  assert.ok(command, "the toggle must be reachable from the palette")
  assert.equal(typeof command.run, "function")

  // Toggling writes through to kv so the choice survives a restart.
  const writes = []
  let toggle
  await plugin.tui(stubApi({
    kv: { get: () => undefined, set: (key, value) => writes.push([key, value]) },
    keymap: { registerLayer: (value) => (toggle = value.commands[0]) },
  }))
  toggle.run()
  assert.deepEqual(writes, [["saia-limits.narrow", "hide"]], "default is always, so the first toggle hides")
  toggle.run()
  assert.deepEqual(writes[1], ["saia-limits.narrow", "always"])
})
