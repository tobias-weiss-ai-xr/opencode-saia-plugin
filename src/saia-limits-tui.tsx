/** @jsxImportSource @opentui/solid */

// SAIA's remaining rate limits, read from `metadata.saiaLimits` by the server
// half and displayed here.
//
//     9/m · 199/h · 128/d · 2.7k/mo
//
// Drawn in the sidebar where the host shows one, and in the prompt row where it
// does not. On a narrow row the display steps down a ladder of tiers rather
// than wrapping it, dropping the longest window first: the minute limit is the
// one that actually bites, so it is the last to go.

import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, For, Show } from "solid-js"
import type { TuiPluginApi, TuiPluginModule, TuiSlotProps } from "@opencode-ai/plugin/tui"

type SaiaLimitsProps = Pick<TuiSlotProps<"session_prompt_right">, "session_id">

/** The provider id this widget speaks for. */
const PROVIDER_ID = "saia"

/** Where the runtime overrides live, so they survive a restart. */
const NARROW_KEY = "saia-limits.narrow"
const PLACEMENT_KEY = "saia-limits.placement"

type MaybeAssistantMessage = {
  role?: string
  providerID?: string
  time?: { completed?: number }
}

/**
 * Whether SAIA is the provider that actually answered last, read from the
 * newest *completed* assistant message.
 *
 * A session that has moved to another provider must not keep showing SAIA's
 * rate limits. `metadata.saiaLimits` is left untouched, so switching back
 * restores the display without a new request. An in-flight turn has not
 * answered yet, so it does not hand over.
 */
export function isActiveProvider(messages: unknown, providerID: string = PROVIDER_ID) {
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index] as MaybeAssistantMessage | undefined
    if (message?.role !== "assistant") continue
    const completed = message.time?.completed
    if (typeof completed !== "number" || !Number.isFinite(completed)) continue
    return message.providerID === providerID
  }
  return false
}

function formatRemaining(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1000) return String(value)

  const thousands = number / 1000
  return `${thousands.toFixed(1).replace(/\.0$/, "")}k`
}

/**
 * The windows in the order they are given up: longest first. A month's budget
 * is rarely the reason a request fails; the minute's very often is.
 */
const WINDOWS: ReadonlyArray<readonly [string, string]> = [
  ["m", "minute"],
  ["h", "hour"],
  ["d", "day"],
  ["mo", "month"],
]

/** Every window the metadata actually carries, already formatted. */
export function limitFields(value: unknown) {
  if (!value || typeof value !== "object") return [] as string[]

  const limits = value as Record<string, unknown>
  return WINDOWS.filter(([, key]) => {
    const remaining = limits[key]
    return remaining !== null && remaining !== undefined && String(remaining) !== ""
  }).map(([unit, key]) => `${formatRemaining(limits[key])}/${unit}`)
}

export function displayLimits(value: unknown) {
  return limitFields(value).join(" · ")
}

/** The candidate renderings for the prompt row, widest first. */
export function tiers(value: unknown) {
  const fields = limitFields(value)
  const candidates: string[] = []
  for (let take = fields.length; take >= 1; take -= 1) {
    candidates.push(fields.slice(0, take).join(" · "))
  }
  return candidates
}

/**
 * Column width as a terminal counts it. Every glyph this widget emits is
 * single-width — digits, `k`, `/`, the unit letters and the `·` separator — so
 * counting code points is exact here rather than merely close.
 */
export function displayWidth(text: unknown) {
  return [...String(text ?? "")].length
}

/**
 * What the widget does when the prompt row is too narrow for even its shortest
 * form.
 *
 *   "always" — print it anyway. At these widths the host's own left segment is
 *              already wrapping, so a strict budget buys a tidy row that does
 *              not exist and costs the numbers.
 *   "hide"   — print nothing, keeping the row as short as the host allows.
 */
export const NARROW_MODES = ["always", "hide"]
export const DEFAULT_NARROW = "always"

export function normaliseNarrow(value: unknown, fallback: unknown = DEFAULT_NARROW) {
  if (NARROW_MODES.includes(value as string)) return value as string
  return NARROW_MODES.includes(fallback as string) ? (fallback as string) : DEFAULT_NARROW
}

export function selectTier(candidates: readonly string[], budget: number, options: { floor?: boolean } = {}) {
  for (const candidate of candidates) {
    if (candidate && displayWidth(candidate) <= budget) return candidate
  }
  if (!options.floor) return ""
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (candidates[index]) return candidates[index]
  }
  return ""
}

/**
 * Columns the prompt row spends before the right-hand strip is divided between
 * the status widgets. Measured, not assumed: the left side carries agent,
 * model, provider and reasoning effort.
 */
export const PROMPT_RESERVE = 72

export function widgetBudget(totalWidth: unknown, widgets = 2) {
  const total = Number(totalWidth)
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.floor((Math.floor(total) - PROMPT_RESERVE) / Math.max(1, widgets)))
}

/**
 * Columns a sidebar row may use. The host's sidebar box is `width={42}` with
 * two columns of padding each side, and the content box inside it adds one
 * more on the right — 37. One further column is held back for the scrollbar.
 */
export const SIDEBAR_BUDGET = 36

/**
 * Where the widget draws.
 *
 *   "auto"    — follow the host: the sidebar when the host shows one, the
 *               prompt row otherwise. The default.
 *   "prompt"  — always the prompt row, even on a wide terminal.
 *   "sidebar" — always the sidebar. Taken literally: the host force-hides the
 *               sidebar in subagent sessions and below 121 columns unless it is
 *               toggled open, and in those cases this mode shows nothing rather
 *               than quietly falling back to the row you asked it to leave
 *               alone.
 */
export const PLACEMENT_MODES = ["auto", "prompt", "sidebar"]
export const DEFAULT_PLACEMENT = "auto"

export function normalisePlacement(value: unknown, fallback: unknown = DEFAULT_PLACEMENT) {
  if (PLACEMENT_MODES.includes(value as string)) return value as string
  return PLACEMENT_MODES.includes(fallback as string) ? (fallback as string) : DEFAULT_PLACEMENT
}

/**
 * Which slot owns the display. Under "auto" this mirrors the host's own rule
 * rather than guessing at it: the sidebar is force-hidden in subagent sessions,
 * and otherwise auto-shows above 120 columns. Each slot renders nothing when
 * the other owns the display, so the widget never appears twice.
 *
 * Known limitation: a plugin cannot observe the manual sidebar toggle. Under
 * "auto", with the sidebar toggled off on a wide terminal, the block is
 * rendered into it and is not visible; toggling it back restores it. Choosing
 * "prompt" sidesteps that entirely.
 */
export function usesSidebar(
  width: unknown,
  session: { parentID?: unknown } | undefined,
  placement: unknown = DEFAULT_PLACEMENT,
) {
  const mode = normalisePlacement(placement)
  if (mode === "prompt") return false
  if (mode === "sidebar") return true
  const total = Number(width)
  if (!Number.isFinite(total)) return false
  return total > 120 && !session?.parentID
}

export function resolveWidth(measuredWidth: unknown, columns: unknown, fallback = 120) {
  for (const candidate of [measuredWidth, columns]) {
    const width = Number(candidate)
    if (Number.isFinite(width) && width > 0) return Math.floor(width)
  }
  return fallback
}

export function renderLimits(value: unknown, options: { width?: unknown; budget?: number; widgets?: number; narrow?: unknown } = {}) {
  const budget = options.budget ?? widgetBudget(options.width ?? 120, options.widgets ?? 2)
  return selectTier(tiers(value), budget, { floor: normaliseNarrow(options.narrow) === "always" })
}

/** The sidebar rendering: a header and as many windows as fit per row. */
export function sidebarLines(value: unknown, budget = SIDEBAR_BUDGET) {
  const fields = limitFields(value)
  if (fields.length === 0) return [] as string[]

  const rows = ["SAIA"]
  let current = ""
  for (const field of fields) {
    const candidate = current ? `${current} · ${field}` : field
    if (current && displayWidth(candidate) > budget) {
      rows.push(current)
      current = field
    } else {
      current = candidate
    }
  }
  if (current) rows.push(current)
  return rows
}

const plugin: TuiPluginModule = {
  id: "saia-limits-tui",
  tui: async (api: TuiPluginApi, options) => {
    // Three layers, narrowest scope first: a value set at runtime by the
    // command below wins, else the `tui.json` plugin options, else the default.
    const settings = (options ?? {}) as { narrow?: unknown; placement?: unknown }
    const stored = (key: string) => {
      try {
        return api.kv.get(key)
      } catch {
        return undefined
      }
    }
    const remember = (key: string, value: string) => {
      try {
        api.kv.set(key, value)
      } catch {
        // Not persisting is survivable; not redrawing is not.
      }
    }
    const [narrow, setNarrow] = createSignal(normaliseNarrow(stored(NARROW_KEY), settings.narrow))
    const [placement, setPlacement] = createSignal(
      normalisePlacement(stored(PLACEMENT_KEY), settings.placement),
    )

    try {
      api.keymap.registerLayer({
        commands: [
          {
            name: "saia_limits_narrow",
            title: "SAIA limits: toggle narrow-terminal behaviour",
            category: "Plugin",
            namespace: "palette",
            slashName: "saia-limits-narrow",
            run() {
              const next = narrow() === "always" ? "hide" : "always"
              setNarrow(next)
              remember(NARROW_KEY, next)
              api.ui.toast({
                message: `SAIA limits on narrow terminals: ${next === "always" ? "always show" : "hide"}`,
              })
            },
          },
          {
            name: "saia_limits_placement",
            title: "SAIA limits: cycle where it draws",
            category: "Plugin",
            namespace: "palette",
            slashName: "saia-limits-placement",
            run() {
              // Three modes, so a cycle rather than a toggle, running from the
              // least opinionated to the most.
              const order = ["auto", "prompt", "sidebar"]
              const next = order[(order.indexOf(placement()) + 1) % order.length]
              setPlacement(next)
              remember(PLACEMENT_KEY, next)
              api.ui.toast({ message: `SAIA limits draw: ${next}` })
            },
          },
        ],
      })
    } catch {
      // A command API that moved must not cost us the widget itself.
    }

    // `api.renderer` is a plain CliRenderer, so reading `.width` off it is not
    // reactive: the widget would keep the width it saw at first render and
    // never move between slots on a resize. `useTerminalDimensions` is the
    // signal the host itself uses for this rule, so both agree. It is a hook,
    // so it is called per component rather than once out here.
    function useWidth() {
      let dimensions: (() => { width: number }) | undefined
      try {
        dimensions = useTerminalDimensions()
      } catch {
        // `useRenderer` throws without a renderer context. Fall back to a
        // non-reactive reading rather than taking the row down with us.
        dimensions = undefined
      }
      const fallback = () => (api.renderer as { width?: unknown } | undefined)?.width
      return () => resolveWidth(dimensions ? dimensions().width : fallback(), process.stdout?.columns)
    }

    /** The limits to draw, or undefined when this widget must stay silent. */
    const active = (session_id: string) => {
      if (!isActiveProvider(api.state.session.messages(session_id))) return undefined
      return api.state.session.get(session_id)?.metadata?.saiaLimits
    }

    function SaiaLimitsPrompt(props: SaiaLimitsProps) {
      const width = useWidth()
      const text = () => {
        try {
          if (usesSidebar(width(), api.state.session.get(props.session_id), placement())) return ""
          return renderLimits(active(props.session_id), { width: width(), narrow: narrow() })
        } catch {
          // A widget must never take the prompt row down with it.
          return ""
        }
      }

      return (
        <box height={1} minWidth={0} flexShrink={1} overflow="hidden">
          <text height={1} wrapMode="none" truncate fg={api.theme.current.textMuted}>
            {text()}
          </text>
        </box>
      )
    }

    function SaiaLimitsSidebar(props: SaiaLimitsProps) {
      const width = useWidth()
      const lines = () => {
        try {
          if (!usesSidebar(width(), api.state.session.get(props.session_id), placement())) return []
          return sidebarLines(active(props.session_id))
        } catch {
          return []
        }
      }

      // `Show` rather than an empty box: a zero-height child would still take a
      // gap row from the sidebar's stack.
      return (
        <Show when={lines().length > 0}>
          <box flexDirection="column" flexShrink={0}>
            <text height={1} wrapMode="none" truncate fg={api.theme.current.text}>
              <b>{lines()[0]}</b>
            </text>
            <For each={lines().slice(1)}>
              {(line) => (
                <text height={1} wrapMode="none" truncate fg={api.theme.current.textMuted}>
                  {line}
                </text>
              )}
            </For>
          </box>
        </Show>
      )
    }

    api.slots.register({
      // First in the strip, and first in the sidebar stack for the same reason.
      order: 100,
      slots: {
        session_prompt_right(_context, props) {
          return <SaiaLimitsPrompt session_id={props.session_id} />
        },
        sidebar_content(_context, props) {
          return <SaiaLimitsSidebar session_id={props.session_id} />
        },
      },
    })
  },
}

export default plugin

// See saia-plugin.ts: installed plugin files can be evaluated as CommonJS outside this
// repository's package boundary. Keep the TUI module's default and named helpers usable.
if (typeof module !== "undefined") {
  module.exports = plugin
  module.exports.displayLimits = displayLimits
  module.exports.isActiveProvider = isActiveProvider
  module.exports.limitFields = limitFields
  module.exports.renderLimits = renderLimits
  module.exports.sidebarLines = sidebarLines
  module.exports.tiers = tiers
  module.exports.normalisePlacement = normalisePlacement
  module.exports.usesSidebar = usesSidebar
}
