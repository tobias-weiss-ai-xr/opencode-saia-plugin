/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi, TuiPluginModule, TuiSlotProps } from "@opencode-ai/plugin/tui"

type SaiaLimitsProps = Pick<TuiSlotProps<"session_prompt_right">, "session_id">

function formatRemaining(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1000) return String(value)

  const thousands = number / 1000
  return `${thousands.toFixed(1).replace(/\.0$/, "")}k`
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
      const text = () => displayLimits(api.state.session.get(props.session_id)?.metadata?.saiaLimits)

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
}
