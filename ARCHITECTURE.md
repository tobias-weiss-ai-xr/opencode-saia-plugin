# Architecture

## Overview

The SAIA plugin connects OpenCode to SAIA (GWDG Chat AI) models through a
layered architecture. OpenCode discovers `plugins/saia-plugin.ts`, which
re-exports the runtime plugin at `plugins/saia/saia.ts`.

```
┌──────────────────────────────────────────────────┐
│                   OpenCode                        │
│  ┌──────────────────────────────────────────────┐│
│  │           Plugin System                       ││
│  │  ┌──────────────────────────────────────┐    ││
│  │  │   plugins/saia-plugin.ts (entry)     │    ││
│  │  └───────────────┬──────────────────────┘    ││
│  │  ┌───────────────▼──────────────────────┐    ││
│  │  │   saia/saia.ts (V1 plugin)           │    ││
│  │  │  - Resolves the API key              │    ││
│  │  │  - Fetches the model list from API   │    ││
│  │  │  - Registers the `saia` provider     │    ││
│  │  │    via the V1 config hook            │    ││
│  │  │  - Applies the transport choice      │    ││
│  │  └───┬────────────────┬─────────────────┘    ││
│  │      │                │                       ││
│  │  ┌───▼───────────┐ ┌──▼──────────────────┐    ││
│  │  │ saia-model-   │ │ saia-memory.ts      │    ││
│  │  │ metadata.js   │ │ - API cache (24h)   │    ││
│  │  │ derives name/ │ │ - Usage tracking    │    ││
│  │  │ attachment    │ │ - Metrics           │    ││
│  │  └───────────────┘ │ - Preferences       │    ││
│  │  ┌───────────────┐ └─────────────────────┘    ││
│  │  │ saia-limits-  │                            ││
│  │  │ server.js     │  captures x-ratelimit-*    ││
│  │  │ saia-limits-  │  headers → quota widget    ││
│  │  │ tui.tsx       │  (session_prompt_right)    ││
│  │  └───────────────┘                            ││
│  └──────────────────────────────────────────────┘│
│                                                   │
│  ┌──────────────────────────────────────────────┐│
│  │     Skill Files (.opencode/skills/)           ││
│  │  saia-refresh  ─  Force cache refresh        ││
│  │  saia-health   ─  API health check           ││
│  │  saia-optimize ─  Model recommendations      ││
│  │  saia-switch-profile ─ Profile switching     ││
│  │  saia-memory-clear ─  Clear memory           ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘

                     │
                     ▼
┌──────────────────────────────────────────────────┐
│            SAIA API (GWDG Chat AI)               │
│  https://chat-ai.academiccloud.de/v1/models      │
└──────────────────────────────────────────────────┘

                     │
                     ▼
┌──────────────────────────────────────────────────┐
│   Optional shell path (src/*.sh, legacy/manual)  │
│  generate-saia-config.sh ─ Static opencode.json  │
│  copy-saia-config.sh     ─ Copy to a project     │
│  validate-config.sh      ─ JSON schema validator │
│  setup-wizard.sh         ─ Interactive setup     │
│  merge-config.sh         ─ Config precedence     │
│  health-report.sh        ─ Health monitoring     │
│  analytics-report.sh     ─ Usage analytics       │
│  sync-config.sh          ─ Remote config sync    │
│  ab-test.sh              ─ A/B testing           │
│  update-plugin.sh        ─ Plugin auto-update    │
│  provider/ollama.sh      ─ Ollama integration    │
└──────────────────────────────────────────────────┘
```

## Data Flow

The plugin default-exports the dual V1+V2 definition: OpenCode 2.x calls
`setup(ctx)` (provider/model transforms + `http.response`/`context` session
hooks), OpenCode ≥1.18.29 calls `server()` (V1 `config`/`chat.headers`/
`experimental.chat.system.transform` hooks). Both paths share one model loader.

1. **OpenCode starts** → discovers `plugins/saia-plugin.ts` → loads `saia/saia.ts`
2. **API key resolved** → env `SAIA_API_KEY`, `apiKeyCommand`, or `saia.json`
3. **Models loaded** → memory cache hit (24 h TTL) or a live `/v1/models` fetch
4. **Provider registered** → V1 `config` hook exposes every ready model under
   the `saia/` prefix; name/attachment/options are derived from the API
   response itself (`saia-model-metadata.js`), never hardcoded
5. **Requests proxied** to the SAIA API using the selected transport
6. **Rate-limit headers captured** (`x-ratelimit-remaining-*`) and rendered in
   the TUI quota footer
7. **Usage/metrics recorded** to `~/.cache/saia/`
8. **Static `opencode.json`** (installed by `install.sh`) remains as the
   no-plugin fallback; `reconcile-opencode-models.sh` prunes stale ids from it


## Data Storage

```
~/.cache/saia/
├── models.json          # API response cache (24h TTL)
├── models-list.json     # Model ID list for change detection
├── usage.jsonl          # Per-use tracking (local)
├── metrics.json         # Per-model performance metrics
├── last-fetch.json      # Timestamp of last successful fetch
└── plugin-backups/      # Plugin update backups

~/.config/opencode/
├── opencode.json        # OpenCode main config
├── plugins/saia/        # SAIA plugin runtime files
├── plugins/saia-plugin.ts # OpenCode discovery entry point
└── saia-preferences.json # User preferences (favorite model, profile)
```

## Profiles

Profiles are applied by the shell path (`generate-saia-config.sh`,
`SAIA_PROFILE=production|development|budget`) and control which models are
included in the generated config.

| Profile     | Models | Default                  | Use Case           |
|-------------|--------|--------------------------|--------------------|
| production  | all 14 | `deepseek-v4-flash-0731` | Critical work      |
| development | 9      | `qwen3.6-35b-a3b`        | Active development |
| budget      | 3      | `meta-llama-3.1-8b-instruct` | Cost optimization |
