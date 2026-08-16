# SAIA Endpoint & Transport

Shows or changes how the plugin reaches SAIA: the **transport** (which client package)
and the **host** (which of SAIA's two hostnames).

## Usage

Trigger this skill when:
- You want to know which transport or host is currently in use
- You want to route through SAIA's other hostname
- A gateway or proxy requires the OpenAI Responses API format
- You need to point the plugin at a LiteLLM proxy

## What this does

Runs the endpoint CLI from the installed runtime:

```bash
node ~/.config/opencode/plugins/saia/saia-endpoint.mjs --show
node ~/.config/opencode/plugins/saia/saia-endpoint.mjs --host gwdg
node ~/.config/opencode/plugins/saia/saia-endpoint.mjs --transport responses
node ~/.config/opencode/plugins/saia/saia-endpoint.mjs --reset-host
```

From a checked-out repository, use `node src/saia-endpoint.mjs` instead.

## Options

| Flag | Values |
|---|---|
| `--transport` | `chat-completions` (default) or `responses` |
| `--host` / `--base-url` | `academiccloud` (default), `gwdg`, or any URL |
| `--reset-host` | drop the host override, return to the default |
| `--show` | print the current selection without changing it |

## Notes

- The two settings are **independent**. Both SAIA hosts serve `/chat/completions` and
  `/responses`, so any combination is valid.
- Rate limits are applied per key and per host. Use `saia-health` or the quota counter in
  the prompt bar to see the limits currently in effect.
- Both settings are written to `~/.config/opencode/saia.json`. Other keys in that file
  (`apiKeyCommand`, `managedModels`) are preserved.
- An explicit `provider.saia.options.baseURL` in `opencode.json` overrides the host
  setting. Remove it if you want this skill to take effect.
- **Restart OpenCode** after a change; the plugin reads these settings at startup.
