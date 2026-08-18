/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi, TuiPluginModule, TuiSlotProps } from "@opencode-ai/plugin/tui"

type SaiaLimitsProps = Pick<TuiSlotProps<"session_prompt_right">, "session_id">

function formatRemaining(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1000) return String(value)

  const thousands = number / 1000
  return `${thousands.toFixed(1).replace(/\.0$/, "")}k`
}

/** The provider id this widget speaks for. */
const PROVIDER_ID = "saia"

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

export function displayLimits(value: unknown) {
  if (!value || typeof value !== "object") return ""

  const limits = value as Record<string, unknown>
  const fields = [
    ["m", limits.minute],
    ["h", limits.hour],
    ["d", limits.day],
    ["mo", limits.month],
  ].filter(([, remaining]) => remaining !== null && remaining !== undefined && String(remaining) !== "")

  if (fields.length === 0) return ""
  return fields.map(([unit, remaining]) => `${formatRemaining(remaining)}/${unit}`).join(" · ")
}

const plugin: TuiPluginModule = {
  id: "saia-limits-tui",
  tui: async (api: TuiPluginApi) => {
    function SaiaLimits(props: SaiaLimitsProps) {
      const text = () => {
        if (!isActiveProvider(api.state.session.messages(props.session_id))) return ""
        return displayLimits(api.state.session.get(props.session_id)?.metadata?.saiaLimits)
      }

      return (
        <box height={1} minWidth={0} flexShrink={1} overflow="hidden">
          <text height={1} wrapMode="none" truncate fg={api.theme.current.textMuted}>
            {text()}
          </text>
        </box>
      )
    }

    api.slots.register({
      order: 100,
      slots: {
        session_prompt_right(_context, props) {
          return <SaiaLimits session_id={props.session_id} />
        },
      },
    })
  },
}

export default plugin

// See saia-plugin.ts: installed plugin files can be evaluated as CommonJS outside this
// repository's package boundary. Keep the TUI module's default and named helper usable.
if (typeof module !== "undefined") {
  module.exports = plugin
  module.exports.displayLimits = displayLimits
  module.exports.isActiveProvider = isActiveProvider
}
