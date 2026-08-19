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
const LAYOUT_KEY = "saia-limits.layout"

export type MaybeAssistantMessage = {
  role?: string
  providerID?: string
  time?: { completed?: number }
}

export type MaybeSession = {
  id?: string
  parentID?: string
  model?: { providerID?: string }
  metadata?: { saiaLimits?: unknown; [key: string]: unknown }
  time?: { created?: number; updated?: number; archived?: number; compacting?: number }
}

/**
 * Whether SAIA is the provider that actually answered last, read from the
 * newest *completed* assistant message, or from the session model / parent
 * if no assistant message has completed yet.
 *
 * A session that has moved to another provider must not keep showing SAIA's
 * rate limits. `metadata.saiaLimits` is left untouched, so switching back
 * restores the display without a new request. An in-flight turn has not
 * answered yet, so it does not hand over.
 */
export function isActiveProvider(
  messages: unknown,
  providerID: string = PROVIDER_ID,
  session?: MaybeSession,
) {
  // If a subagent using this provider recently updated limits on the session
  if (
    session?.metadata?.saiaLimits &&
    typeof session.metadata.saiaLimits === "object" &&
    Boolean((session.metadata.saiaLimits as { subagent?: unknown }).subagent)
  ) {
    return true
  }

  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index] as MaybeAssistantMessage | undefined
    if (message?.role !== "assistant") continue
    const completed = message.time?.completed
    if (typeof completed !== "number" || !Number.isFinite(completed)) continue
    return message.providerID === providerID
  }

  // If no completed assistant message is present in the list yet, check session model
  if (session?.model?.providerID) {
    return session.model.providerID === providerID
  }

  return false
}

function formatRemaining(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1000) return String(value)

  const thousands = number / 1000
  return `${thousands.toFixed(1).replace(/\.0$/, "")}k`
}

/** The windows, in the order they are read. */
const WINDOWS: ReadonlyArray<readonly [string, string]> = [
  ["m", "minute"],
  ["h", "hour"],
  ["d", "day"],
  ["mo", "month"],
]

/**
 * The order the windows are given up in as the row narrows, least useful first.
 *
 * The month is rarely why a request fails, so it goes first. The minute goes
 * next despite being the tightest number: it refills within a minute, so a low
 * one resolves itself while you read it. The hour and the day are the ones you
 * can actually run out of for the rest of a working session, and the hour is
 * the last to go.
 */
const SACRIFICE_ORDER = ["mo", "m", "d"] as const

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

function unitOf(field: string) {
  return field.slice(field.indexOf("/") + 1)
}

/**
 * The candidate renderings for one line, widest first: the whole set, then the
 * same set with each sacrificed window removed in turn. Reading order is
 * preserved throughout — only membership changes.
 */
export function tiers(value: unknown) {
  const fields = limitFields(value)
  if (fields.length === 0) return [] as string[]

  const subagent = (value as { subagent?: unknown })?.subagent
  const tag = subagent
    ? typeof subagent === "string" && subagent !== "true"
      ? `(subagent: ${subagent})`
      : "(subagent)"
    : undefined

  const candidates = [tag ? `${fields.join(" · ")} · ${tag}` : fields.join(" · ")]
  let remaining = fields
  for (const unit of SACRIFICE_ORDER) {
    if (remaining.length <= 1) break
    const next = remaining.filter((field) => unitOf(field) !== unit)
    if (next.length === remaining.length || next.length === 0) continue
    remaining = next
    candidates.push(remaining.join(" · "))
  }
  return candidates
}

/**
 * Rows for the prompt row. One line under "line", where the tier ladder decides
 * what survives; as many as it takes under "stack", where nothing is given up
 * because a short line always fits.
 */
export function promptLines(
  value: unknown,
  options: { width?: unknown; budget?: number; widgets?: number; narrow?: unknown; layout?: unknown } = {},
) {
  const budget = options.budget ?? widgetBudget(options.width ?? 120, options.widgets ?? 2)
  if (normaliseLayout(options.layout) === "line") {
    const line = selectTier(tiers(value), budget, { floor: normaliseNarrow(options.narrow) === "always" })
    return line ? [line] : []
  }
  return packRows(limitFields(value), budget)
}

/**
 * Fit as many windows on a row as the budget allows, then start another. A
 * window never gets split across rows and never gets dropped: if one is wider
 * than the budget it takes a row of its own and the `truncate` backstop deals
 * with the overflow.
 */
export function packRows(fields: readonly string[], budget: number) {
  const rows: string[] = []
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

/**
 * How the prompt row is laid out.
 *
 *   "line"  — one line, narrowing by giving up windows. The default.
 *   "stack" — one row per group of windows that fits, giving up nothing. The
 *             prompt box grows a line or two; in exchange every window stays
 *             readable at any width.
 */
export const LAYOUT_MODES = ["line", "stack"]
export const DEFAULT_LAYOUT = "line"

export function normaliseLayout(value: unknown, fallback: unknown = DEFAULT_LAYOUT) {
  if (LAYOUT_MODES.includes(value as string)) return value as string
  return LAYOUT_MODES.includes(fallback as string) ? (fallback as string) : DEFAULT_LAYOUT
}

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
 *   "both"    — draw in both the sidebar and the prompt row under the chatbox.
 */
export const PLACEMENT_MODES = ["auto", "prompt", "sidebar", "both"]
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
 * Under "both", the widget draws in both the sidebar and prompt row simultaneously.
 *
 * Known limitation: a plugin cannot observe the manual sidebar toggle. Under
 * "auto", with the sidebar toggled off on a wide terminal, the block is
 * rendered into it and is not visible; toggling it back restores it. Choosing
 * "prompt" or "both" sidesteps that entirely.
 */
export function usesSidebar(
  width: unknown,
  session: { parentID?: unknown } | undefined,
  placement: unknown = DEFAULT_PLACEMENT,
) {
  const mode = normalisePlacement(placement)
  if (mode === "prompt") return false
  if (mode === "sidebar" || mode === "both") return true
  const total = Number(width)
  if (!Number.isFinite(total)) return false
  return total > 120 && !session?.parentID
}

export function usesPrompt(
  width: unknown,
  session: { parentID?: unknown } | undefined,
  placement: unknown = DEFAULT_PLACEMENT,
) {
  const mode = normalisePlacement(placement)
  if (mode === "sidebar") return false
  if (mode === "prompt" || mode === "both") return true
  const total = Number(width)
  if (!Number.isFinite(total)) return true
  return !(total > 120 && !session?.parentID)
}

export function resolveSessionLimits(
  sessionId: string,
  getSession: (id: string) => MaybeSession | undefined,
) {
  let currentId: string | undefined = sessionId
  const seen = new Set<string>()
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const session = getSession(currentId)
    if (session?.metadata?.saiaLimits) {
      return session.metadata.saiaLimits
    }
    currentId = session?.parentID
  }
  return undefined
}

export function isSessionUsingSaia(
  sessionId: string,
  getSession: (id: string) => MaybeSession | undefined,
  getMessages: (id: string) => unknown,
  providerID: string = PROVIDER_ID,
) {
  const rootSession = getSession(sessionId)
  if (
    rootSession?.metadata?.saiaLimits &&
    typeof rootSession.metadata.saiaLimits === "object" &&
    Boolean((rootSession.metadata.saiaLimits as { subagent?: unknown }).subagent)
  ) {
    return true
  }

  let currentId: string | undefined = sessionId
  const seen = new Set<string>()
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const session = getSession(currentId)
    const messages = getMessages(currentId)
    const list = Array.isArray(messages) ? messages : []

    const hasCompletedAssistant = list.some((m) => {
      const msg = m as MaybeAssistantMessage | undefined
      return (
        msg?.role === "assistant" &&
        typeof msg.time?.completed === "number" &&
        Number.isFinite(msg.time.completed)
      )
    })

    if (hasCompletedAssistant) {
      return isActiveProvider(list, providerID, session)
    }

    if (session?.model?.providerID) {
      return session.model.providerID === providerID
    }

    currentId = session?.parentID
  }

  return false
}

export function isMainSessionUsingSaia(
  sessionId: string,
  getSession: (id: string) => MaybeSession | undefined,
  getMessages: (id: string) => unknown,
  providerID: string = PROVIDER_ID,
) {
  const session = getSession(sessionId)
  if (session?.parentID) {
    return isSessionUsingSaia(sessionId, getSession, getMessages, providerID)
  }

  const messages = getMessages(sessionId)
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index] as MaybeAssistantMessage | undefined
    if (message?.role !== "assistant") continue
    const completed = message.time?.completed
    if (typeof completed !== "number" || !Number.isFinite(completed)) continue
    return message.providerID === providerID
  }

  if (session?.model?.providerID) {
    return session.model.providerID === providerID
  }

  return false
}

export function resolveSubagentLimits(
  sessionId: string,
  getSession: (id: string) => MaybeSession | undefined,
) {
  const session = getSession(sessionId)
  if (!session) return undefined
  const sub = session.metadata?.saiaSubagentLimits
  if (sub && typeof sub === "object" && (sub as { subagent?: unknown }).subagent) {
    return sub
  }
  const limits = session.metadata?.saiaLimits
  if (limits && typeof limits === "object" && (limits as { subagent?: unknown }).subagent) {
    return limits
  }
  return undefined
}

export function getActiveSubagents(
  subagentsMap: unknown,
  getStatus: (id: string) => { type?: string } | undefined,
  getSession: (id: string) => MaybeSession | undefined,
): Array<{ id: string; name: string; model?: string }> {
  if (!subagentsMap || typeof subagentsMap !== "object") return []
  const list = Object.values(
    subagentsMap as Record<string, { id?: string; name?: string; model?: string; updated?: number }>,
  )
  const active: Array<{ id: string; name: string; model?: string; updated?: number }> = []

  for (const item of list) {
    if (!item || typeof item !== "object" || !item.id) continue
    const status = getStatus(item.id)
    const session = getSession(item.id)

    if (
      status?.type === "idle" ||
      (typeof session?.time?.archived === "number" && Number.isFinite(session.time.archived))
    ) {
      continue
    }

    if (status?.type === "busy" || status?.type === "retry") {
      active.push({ id: item.id, name: item.name || "subagent", model: item.model, updated: item.updated })
      continue
    }

    if (item.updated && Date.now() - item.updated < 60_000) {
      active.push({ id: item.id, name: item.name || "subagent", model: item.model, updated: item.updated })
    }
  }

  active.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
  return active
}

export function formatSubagentLines(
  subagents: Array<{ name: string; model?: string }>,
  max = 5,
): string[] {
  if (subagents.length === 0) return []
  const formatItem = (s: { name: string; model?: string }) => {
    const shortModel = s.model ? s.model.replace(/-mitarbeitende$/i, "").replace(/-Mitarbeitende$/, "") : ""
    return shortModel ? `${s.name} · ${shortModel}` : s.name
  }

  if (subagents.length <= max) {
    return subagents.map(formatItem)
  }

  const shown = subagents.slice(0, max - 1)
  const remaining = subagents.length - shown.length
  const lines = shown.map(formatItem)
  lines.push(`and ${remaining} more`)
  return lines
}

export function resolveWidth(measuredWidth: unknown, columns: unknown, fallback = 120) {
  for (const candidate of [measuredWidth, columns]) {
    const width = Number(candidate)
    if (Number.isFinite(width) && width > 0) return Math.floor(width)
  }
  return fallback
}

export function renderLimits(
  value: unknown,
  options: { width?: unknown; budget?: number; widgets?: number; narrow?: unknown } = {},
) {
  return promptLines(value, { ...options, layout: "line" })[0] ?? ""
}

/** The sidebar rendering: a header and as many windows as fit per row. */
export function sidebarLines(value: unknown, budget = SIDEBAR_BUDGET) {
  const fields = limitFields(value)
  if (fields.length === 0) return [] as string[]
  const subagent = (value as { subagent?: unknown })?.subagent
  const header = subagent
    ? typeof subagent === "string" && subagent !== "true"
      ? `SAIA (${subagent})`
      : "SAIA (subagent)"
    : "SAIA"
  return [header, ...packRows(fields, budget)]
}

const plugin: TuiPluginModule = {
  id: "saia-limits-tui",
  tui: async (api: TuiPluginApi, options) => {
    // Three layers, narrowest scope first: a value set at runtime by the
    // command below wins, else the `tui.json` plugin options, else the default.
    const settings = (options ?? {}) as { narrow?: unknown; placement?: unknown; layout?: unknown }
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
    const [layout, setLayout] = createSignal(normaliseLayout(stored(LAYOUT_KEY), settings.layout))

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
            title: "SAIA limits: cycle widget placement",
            category: "Plugin",
            namespace: "palette",
            slashName: "saia-limits-placement",
            run() {
              const current = placement()
              const index = PLACEMENT_MODES.indexOf(current)
              const next = PLACEMENT_MODES[(index + 1) % PLACEMENT_MODES.length]
              setPlacement(next)
              remember(PLACEMENT_KEY, next)
              api.ui.toast({ message: `SAIA limits placement: ${next}` })
            },
          },
          {
            name: "saia_limits_layout",
            title: "SAIA limits: toggle stacked rows under the prompt",
            category: "Plugin",
            namespace: "palette",
            slashName: "saia-limits-layout",
            run() {
              const next = layout() === "line" ? "stack" : "line"
              setLayout(next)
              remember(LAYOUT_KEY, next)
              api.ui.toast({
                message: `SAIA limits in the prompt row: ${next === "stack" ? "stacked rows" : "one line"}`,
              })
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
      if (
        !isSessionUsingSaia(
          session_id,
          (id) => api.state.session.get(id),
          (id) => api.state.session.messages(id),
        )
      ) {
        return undefined
      }
      return resolveSessionLimits(session_id, (id) => api.state.session.get(id))
    }

    function SaiaLimitsPrompt(props: SaiaLimitsProps) {
      const width = useWidth()
      const rows = () => {
        try {
          if (!usesPrompt(width(), api.state.session.get(props.session_id), placement())) return []
          if (
            !isMainSessionUsingSaia(
              props.session_id,
              (id) => api.state.session.get(id),
              (id) => api.state.session.messages(id),
            )
          ) {
            return []
          }
          const limits = resolveSessionLimits(props.session_id, (id) => api.state.session.get(id))
          if (!limits) return []
          return promptLines(limits, {
            width: width(),
            narrow: narrow(),
            layout: layout(),
          })
        } catch {
          // A widget must never take the prompt row down with it.
          return []
        }
      }

      // `height` follows the row count so a stacked block grows the prompt box
      // and a single line still occupies exactly one row. `truncate` on each
      // row remains the backstop against a mis-measured width.
      return (
        <box flexDirection="column" height={rows().length} minWidth={0} flexShrink={1} overflow="hidden">
          <For each={rows()}>
            {(row) => (
              <text height={1} wrapMode="none" truncate fg={api.theme.current.textMuted}>
                {row}
              </text>
            )}
          </For>
        </box>
      )
    }

    function SaiaLimitsSidebar(props: SaiaLimitsProps) {
      const width = useWidth()
      const lines = () => {
        try {
          if (!usesSidebar(width(), api.state.session.get(props.session_id), placement())) return []
          if (
            !isMainSessionUsingSaia(
              props.session_id,
              (id) => api.state.session.get(id),
              (id) => api.state.session.messages(id),
            )
          ) {
            return []
          }
          const limits = resolveSessionLimits(props.session_id, (id) => api.state.session.get(id))
          if (!limits || typeof limits !== "object") return []
          return sidebarLines({ ...(limits as Record<string, unknown>), subagent: false })
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

    function SaiaSubagentSidebar(props: SaiaLimitsProps) {
      const width = useWidth()
      const data = () => {
        try {
          if (!usesSidebar(width(), api.state.session.get(props.session_id), placement())) return undefined
          const limits = resolveSubagentLimits(props.session_id, (id) => api.state.session.get(id))
          if (!limits) return undefined

          const session = api.state.session.get(props.session_id)
          let activeList = getActiveSubagents(
            session?.metadata?.saiaSubagents,
            (id) => api.state.session.status(id),
            (id) => api.state.session.get(id),
          )

          if (activeList.length === 0 && (limits as { subagent?: unknown })?.subagent) {
            const sub = (limits as { subagent?: unknown; model?: unknown }).subagent
            const subName = typeof sub === "string" && sub !== "true" ? sub : ""
            if (subName) {
              const model =
                typeof (limits as { model?: unknown }).model === "string"
                  ? (limits as { model?: string }).model
                  : ""
              activeList = [{ id: props.session_id, name: subName, model }]
            }
          }

          if (activeList.length === 0) return undefined

          const quotaRows = packRows(limitFields(limits), SIDEBAR_BUDGET)
          if (quotaRows.length === 0) return undefined

          const subagentRows = formatSubagentLines(activeList, 5)

          return {
            title: "SAIA",
            quotaRows,
            subagentRows,
          }
        } catch {
          return undefined
        }
      }

      return (
        <Show when={data()}>
          {(d) => (
            <box flexDirection="column" flexShrink={0}>
              <text height={1} wrapMode="none" truncate fg={api.theme.current.text}>
                <b>Subagents</b>
              </text>
              <text height={1} wrapMode="none" truncate fg={api.theme.current.text}>
                <b>{d().title}</b>
              </text>
              <For each={d().quotaRows}>
                {(row) => (
                  <text height={1} wrapMode="none" truncate fg={api.theme.current.textMuted}>
                    {row}
                  </text>
                )}
              </For>
              <For each={d().subagentRows}>
                {(row) => (
                  <text height={1} wrapMode="none" truncate fg={api.theme.current.textMuted}>
                    {row}
                  </text>
                )}
              </For>
            </box>
          )}
        </Show>
      )
    }

    api.slots.register({
      // First in the strip, and first in the sidebar stack for main chat model.
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

    api.slots.register({
      // Subagents section, placed after main model quotas and cache-hit.
      order: 140,
      slots: {
        sidebar_content(_context, props) {
          return <SaiaSubagentSidebar session_id={props.session_id} />
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
  module.exports.packRows = packRows
  module.exports.promptLines = promptLines
  module.exports.tiers = tiers
  module.exports.normalisePlacement = normalisePlacement
  module.exports.usesSidebar = usesSidebar
  module.exports.usesPrompt = usesPrompt
  module.exports.resolveSessionLimits = resolveSessionLimits
  module.exports.isSessionUsingSaia = isSessionUsingSaia
  module.exports.isMainSessionUsingSaia = isMainSessionUsingSaia
  module.exports.resolveSubagentLimits = resolveSubagentLimits
  module.exports.getActiveSubagents = getActiveSubagents
  module.exports.formatSubagentLines = formatSubagentLines
}
