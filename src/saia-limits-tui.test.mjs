import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_NARROW,
  DEFAULT_LAYOUT,
  DEFAULT_PLACEMENT,
  displayLimits,
  displayWidth,
  isActiveProvider,
  isSessionUsingSaia,
  limitFields,
  normaliseNarrow,
  normaliseLayout,
  normalisePlacement,
  packRows,
  promptLines,
  renderLimits,
  resolveSessionLimits,
  selectTier,
  sidebarLines,
  tiers,
  usesPrompt,
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

test("checks session model when there are no completed assistant messages yet", () => {
  assert.equal(isActiveProvider([], "saia", { model: { providerID: "saia" } }), true)
  assert.equal(isActiveProvider([], "saia", { model: { providerID: "anthropic" } }), false)
  // If a completed message exists, it takes precedence over initial model
  assert.equal(isActiveProvider([other], "saia", { model: { providerID: "saia" } }), false)
  assert.equal(isActiveProvider([saia], "saia", { model: { providerID: "anthropic" } }), true)
})

test("takes the provider id as an argument, so the rule is reusable", () => {
  assert.equal(isActiveProvider([saia, other], "kiconnect"), true)
  assert.equal(isActiveProvider([other, saia], "kiconnect"), false)
})

test("resolves session limits walking up parent sessions if needed", () => {
  const sessions = new Map([
    ["root", { id: "root", metadata: { saiaLimits: LIMITS } }],
    ["sub_with_limits", { id: "sub_with_limits", parentID: "root", metadata: { saiaLimits: { minute: 5 } } }],
    ["sub_empty", { id: "sub_empty", parentID: "root", metadata: {} }],
    ["nested_sub", { id: "nested_sub", parentID: "sub_empty" }],
  ])
  const getSession = (id) => sessions.get(id)

  assert.deepEqual(resolveSessionLimits("root", getSession), LIMITS)
  assert.deepEqual(resolveSessionLimits("sub_with_limits", getSession), { minute: 5 })
  assert.deepEqual(resolveSessionLimits("sub_empty", getSession), LIMITS)
  assert.deepEqual(resolveSessionLimits("nested_sub", getSession), LIMITS)
  assert.equal(resolveSessionLimits("unknown", getSession), undefined)
})

test("identifies when subagent or parent sessions run SAIA", () => {
  const sessions = new Map([
    ["parent_saia", { id: "parent_saia", model: { providerID: "saia" } }],
    ["parent_other", { id: "parent_other", model: { providerID: "anthropic" } }],
    ["sub_saia", { id: "sub_saia", parentID: "parent_other", model: { providerID: "saia" } }],
    ["sub_other", { id: "sub_other", parentID: "parent_saia", model: { providerID: "anthropic" } }],
    ["sub_inherit", { id: "sub_inherit", parentID: "parent_saia" }],
  ])
  const messages = new Map([
    ["parent_saia", [saia]],
    ["parent_other", [other]],
    ["sub_saia", []],
    ["sub_other", []],
    ["sub_inherit", []],
  ])
  const getSession = (id) => sessions.get(id)
  const getMessages = (id) => messages.get(id) ?? []

  assert.equal(isSessionUsingSaia("parent_saia", getSession, getMessages), true)
  assert.equal(isSessionUsingSaia("parent_other", getSession, getMessages), false)
  assert.equal(isSessionUsingSaia("sub_saia", getSession, getMessages), true, "subagent running SAIA shows limits")
  assert.equal(isSessionUsingSaia("sub_other", getSession, getMessages), false, "subagent running non-SAIA does not show SAIA limits")
  assert.equal(isSessionUsingSaia("sub_inherit", getSession, getMessages), true, "subagent inheriting from SAIA parent shows limits")
})

/* -- Narrow prompt rows ----------------------------------------------------- */

test("gives up the month first and the hour last", () => {
  // The month is rarely why a request fails. The minute goes next despite
  // being the tightest number, because it refills within a minute — a low one
  // resolves itself while you read it. The hour and the day are what you can
  // actually run out of for the rest of a session.
  assert.deepEqual(tiers(LIMITS), [
    "9/m · 199/h · 128/d · 2.7k/mo",
    "9/m · 199/h · 128/d",
    "199/h · 128/d",
    "199/h",
  ])
  assert.deepEqual(tiers({}), [])
  assert.deepEqual(tiers(null), [])
})

test("keeps reading order while membership shrinks", () => {
  for (const tier of tiers(LIMITS)) {
    const units = tier.split(" · ").map((field) => field.slice(field.indexOf("/") + 1))
    assert.deepEqual(units, [...units].sort((a, b) => ["m", "h", "d", "mo"].indexOf(a) - ["m", "h", "d", "mo"].indexOf(b)))
  }
})

test("drops nothing when only some windows are reported", () => {
  assert.deepEqual(tiers({ hour: 199 }), ["199/h"])
  assert.deepEqual(tiers({ minute: 9, month: 2_700 }), ["9/m · 2.7k/mo", "9/m"])
})

test("steps down a tier as the terminal narrows", () => {
  const at = (width) => renderLimits(LIMITS, { width })
  assert.equal(at(140), "9/m · 199/h · 128/d · 2.7k/mo")
  assert.equal(at(120), "9/m · 199/h · 128/d", "the day survives well into a narrow row")
  assert.equal(at(110), "9/m · 199/h · 128/d")
  assert.equal(at(100), "199/h · 128/d")
  assert.equal(at(92), "199/h")
  // Past the last tier the two narrow modes part company.
  assert.equal(renderLimits(LIMITS, { width: 76, narrow: "hide" }), "")
  assert.equal(at(76), "199/h", "the default keeps the number that matters")
})

test("keeps the narrowest tier when nothing fits, unless told to hide", () => {
  for (const width of [76, 65, 40, 4]) {
    assert.equal(renderLimits(LIMITS, { width }), "199/h", `${width} columns, default`)
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

test("honours a forced placement in either direction or both", () => {
  // "prompt": never the sidebar, always the prompt
  assert.equal(usesSidebar(200, {}, "prompt"), false)
  assert.equal(usesSidebar(40, {}, "prompt"), false)
  assert.equal(usesPrompt(200, {}, "prompt"), true)
  assert.equal(usesPrompt(40, {}, "prompt"), true)

  // "sidebar": always the sidebar, never the prompt
  assert.equal(usesSidebar(40, {}, "sidebar"), true)
  assert.equal(usesSidebar(200, { parentID: "ses_parent" }, "sidebar"), true)
  assert.equal(usesPrompt(200, {}, "sidebar"), false)
  assert.equal(usesPrompt(40, {}, "sidebar"), false)

  // "both": draws in both sidebar and prompt
  assert.equal(usesSidebar(200, {}, "both"), true)
  assert.equal(usesSidebar(40, {}, "both"), true)
  assert.equal(usesPrompt(200, {}, "both"), true)
  assert.equal(usesPrompt(40, {}, "both"), true)

  // Anything unrecognised is "auto", not another behaviour
  assert.equal(usesSidebar(200, {}, "nonsense"), true)
  assert.equal(usesSidebar(40, {}, "nonsense"), false)
  assert.equal(usesPrompt(200, {}, "nonsense"), false)
  assert.equal(usesPrompt(40, {}, "nonsense"), true)
})

test("normalises a placement, falling back rather than trusting input", () => {
  assert.equal(DEFAULT_PLACEMENT, "auto")
  for (const mode of ["auto", "prompt", "sidebar", "both"]) assert.equal(normalisePlacement(mode), mode)
  assert.equal(normalisePlacement(undefined), "auto")
  assert.equal(normalisePlacement("floating"), "auto")
  // A bad value from tui.json falls through to the layer beneath it.
  assert.equal(normalisePlacement(undefined, "prompt"), "prompt")
  assert.equal(normalisePlacement("floating", "sidebar"), "sidebar")
  assert.equal(normalisePlacement(undefined, "both"), "both")
})

test("gives the sidebar the display exactly when the host would show it", () => {
  // The host's rule: a 42-column sidebar, auto above 120 columns, force-hidden
  // in a subagent session.
  assert.equal(usesSidebar(121, {}), true)
  assert.equal(usesSidebar(120, {}), false, "120 is not wider than 120")
  assert.equal(usesSidebar(200, { parentID: "ses_parent" }), false, "a subagent session has no sidebar")
  assert.equal(usesSidebar(200, undefined), true)
  assert.equal(usesSidebar(undefined, {}), false)
  assert.equal(usesSidebar("nonsense", {}), false)

  // In auto mode, prompt is the inverse of sidebar
  assert.equal(usesPrompt(121, {}), false)
  assert.equal(usesPrompt(120, {}), true)
  assert.equal(usesPrompt(200, { parentID: "ses_parent" }), true, "subagent session uses prompt")
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

  // Subagent indicators
  assert.deepEqual(sidebarLines({ ...LIMITS, subagent: true }), ["SAIA (subagent)", "9/m · 199/h · 128/d · 2.7k/mo"])
  assert.deepEqual(sidebarLines({ ...LIMITS, subagent: "Scout" }), ["SAIA (Scout)", "9/m · 199/h · 128/d · 2.7k/mo"])
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
  const registered = []
  await plugin.tui(stubApi({ slots: { register: (value) => registered.push(value) } }))

  assert.equal(registered[0].order, 100, "first in the strip and first in the sidebar stack")
  assert.equal(typeof registered[0].slots.session_prompt_right, "function")
  assert.equal(typeof registered[0].slots.sidebar_content, "function")
  assert.equal(registered[1].order, 140, "subagents section placed after main model quotas")
  assert.equal(typeof registered[1].slots.sidebar_content, "function")
})

test("survives a host without the optional apis it uses", async () => {
  // kv, keymap and ui are all conveniences: losing the toggle is survivable,
  // losing the widget is not.
  const bare = stubApi({ kv: undefined, keymap: undefined, ui: undefined })
  const registered = []
  bare.slots = { register: (value) => registered.push(value) }
  await plugin.tui(bare)
  assert.equal(typeof registered[0].slots.sidebar_content, "function")
})

test("registers a command that cycles where the widget draws", async () => {
  const writes = []
  let layer
  await plugin.tui(stubApi({
    kv: { get: () => undefined, set: (key, value) => writes.push([key, value]) },
    keymap: { registerLayer: (value) => (layer = value) },
  }))

  const command = layer.commands.find((item) => item.slashName === "saia-limits-placement")
  assert.ok(command, "the placement cycle must be reachable from the palette")

  // Least opinionated first, and back round again.
  command.run()
  command.run()
  command.run()
  command.run()
  assert.deepEqual(writes, [
    ["saia-limits.placement", "prompt"],
    ["saia-limits.placement", "sidebar"],
    ["saia-limits.placement", "both"],
    ["saia-limits.placement", "auto"],
  ])
})

test("takes its starting placement from tui.json options, and kv over that", async () => {
  let fromOptions
  await plugin.tui(stubApi({ slots: { register: (value) => (fromOptions = value) } }), { placement: "prompt" })
  assert.equal(typeof fromOptions.slots.sidebar_content, "function", "both slots register whatever the mode")

  const writes = []
  let cycle
  await plugin.tui(
    stubApi({
      kv: { get: (key) => (key === "saia-limits.placement" ? "sidebar" : undefined), set: (k, v) => writes.push([k, v]) },
      keymap: { registerLayer: (value) => (cycle = value.commands.find((c) => c.slashName === "saia-limits-placement")) },
    }),
    { placement: "prompt" },
  )
  // kv said "sidebar", so the next step in the cycle is "both" — the stored
  // value wins over the configured one.
  cycle.run()
  assert.deepEqual(writes, [["saia-limits.placement", "both"]])
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

/* -- Stacked rows ----------------------------------------------------------- */

test("stacking gives up no window at any width", () => {
  const rows = (width) => promptLines(LIMITS, { width, layout: "stack" })

  assert.deepEqual(rows(120), ["9/m · 199/h · 128/d", "2.7k/mo"])
  // 14 columns: `128/d · 2.7k/mo` is 15, so the month takes its own row.
  assert.deepEqual(rows(100), ["9/m · 199/h", "128/d", "2.7k/mo"])
  // A budget of nothing still shows everything, one window per row.
  assert.deepEqual(rows(40), ["9/m", "199/h", "128/d", "2.7k/mo"])

  for (const width of [140, 120, 100, 84, 65, 40]) {
    assert.equal(rows(width).join(" · "), displayLimits(LIMITS), `${width} columns keeps every window`)
  }
})

test("line layout yields at most one row, stacking as many as it needs", () => {
  assert.equal(promptLines(LIMITS, { width: 120 }).length, 1)
  assert.equal(promptLines(LIMITS, { width: 120, layout: "line" }).length, 1)
  assert.ok(promptLines(LIMITS, { width: 40, layout: "stack" }).length > 1)
  // Nothing stored means no rows at all, in either layout.
  assert.deepEqual(promptLines(undefined, { width: 120, layout: "stack" }), [])
  assert.deepEqual(promptLines({}, { width: 120 }), [])
})

test("packs rows without splitting or dropping a window", () => {
  assert.deepEqual(packRows(["9/m", "199/h", "128/d"], 11), ["9/m · 199/h", "128/d"])
  assert.deepEqual(packRows(["9/m", "199/h"], 100), ["9/m · 199/h"])
  // Wider than the budget: its own row, and the truncate backstop handles it.
  assert.deepEqual(packRows(["2.7k/mo"], 2), ["2.7k/mo"])
  assert.deepEqual(packRows([], 40), [])
})

test("normalises a layout, falling back rather than trusting input", () => {
  assert.equal(DEFAULT_LAYOUT, "line")
  assert.equal(normaliseLayout("stack"), "stack")
  assert.equal(normaliseLayout(undefined), "line")
  assert.equal(normaliseLayout("diagonal"), "line")
  assert.equal(normaliseLayout(undefined, "stack"), "stack")
  assert.equal(normaliseLayout("diagonal", "stack"), "stack")
})

test("registers a command that toggles stacked rows", async () => {
  const writes = []
  let layer
  await plugin.tui(stubApi({
    kv: { get: () => undefined, set: (key, value) => writes.push([key, value]) },
    keymap: { registerLayer: (value) => (layer = value) },
  }))

  const command = layer.commands.find((item) => item.slashName === "saia-limits-layout")
  assert.ok(command, "the layout toggle must be reachable from the palette")
  command.run()
  command.run()
  assert.deepEqual(writes, [["saia-limits.layout", "stack"], ["saia-limits.layout", "line"]])
})
