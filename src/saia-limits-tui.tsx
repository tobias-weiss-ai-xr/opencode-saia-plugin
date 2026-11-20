/** @jsxImportSource @opentui/solid */

import type { Plugin } from "@opencode/plugin/tui"
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

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

function SaiaLimits(props: { ctx: Plugin.Context; sessionID?: string }) {
  const text = () =>
    props.sessionID
      ? displayLimits(props.ctx.data.session.get(props.sessionID)?.metadata?.saiaLimits)
      : ""

  return (
    <box height={1} minWidth={0} flexShrink={1} overflow="hidden">
      <text height={1} wrapMode="none" truncate fg={props.ctx.theme.text.muted}>
        {text()}
      </text>
    </box>
  )
}

function V1SaiaLimits(props: { api: TuiPluginApi; session_id?: string }) {
  const text = () => displayLimits(props.api.state.session.get(props.session_id)?.metadata?.saiaLimits)

  return (
    <box height={1} minWidth={0} flexShrink={1} overflow="hidden">
      <text height={1} wrapMode="none" truncate fg={props.api.theme.current.textMuted}>
        {text()}
      </text>
    </box>
  )
}

// OpenCode 2.x registration: claim "prompt.footer" through the TUI context.
const v2Setup = (ctx: Plugin.Context) => {
  // Guard against being loaded by a non-TUI host (e.g. OpenCode's server-side
  // plugin discovery): there is no slot tree to render into.
  if (typeof ctx?.ui?.slot !== "function") return

  ctx.ui.slot({
    append: "prompt.footer",
    render: (input) => <SaiaLimits ctx={ctx} sessionID={input.sessionID} />,
  })
}

// OpenCode 1.x registration: the "tui" key is ignored by OpenCode 2.x and vice versa.
const v1Tui = async (api: TuiPluginApi) => {
  api.slots.register({
    order: 100,
    slots: {
      session_prompt_right(_context, props) {
        return <V1SaiaLimits api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin = {
  id: "saia-limits-tui",
  setup: v2Setup,
  tui: v1Tui,
} as TuiPluginModule & { setup: (ctx: Plugin.Context) => void }

export default plugin

// See saia-plugin.ts: installed plugin files can be evaluated as CommonJS outside this
// repository's package boundary. Keep the TUI module's default and named helper usable.
if (typeof module !== "undefined") {
  module.exports = plugin
  module.exports.displayLimits = displayLimits
}
