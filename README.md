# SAIA Plugin for OpenCode

OpenCode plugin that adds all [SAIA](https://chat-ai.academiccloud.de) (GWDG Chat AI) models to your OpenCode setup.

> **OpenCode 2.x**: supported since plugin v0.4.0. The server plugin (`saia-plugin.ts`)
> exports the dual V1+V2 definition — OpenCode 2.x reads `id` + `setup(ctx)`,
> OpenCode ≥1.18.29 calls `server()`. The TUI quota widget registers the
> `prompt.footer` slot (OpenCode 2.x) or `session_prompt_right` (1.x) and is
> registered in both `cli.json` (`plugins`, v2) and `tui.json` (`plugin`, v1).

**Repositories:** 
- **Primary (active development):** [GitHub](https://github.com/tobias-weiss-ai-xr/opencode-saia-plugin)
- **Legacy mirror:** [Codeberg](https://codeberg.org/graphwiz-ai/opencode-saia-plugin) (synced periodically, PRs welcome but development happens on GitHub)
- **Original (reference):** [GitLab](https://gitlab-ce.gwdg.de/jlewis/opencode-saia-plugin) (jlewis/GWDG)

**Other Platforms:**
- [zot-saia-plugin](https://github.com/tobias-weiss-ai-xr/zot-saia-plugin) — SAIA provider for zot CLI
- [pi-saia-plugin](https://github.com/tobias-weiss-ai-xr/pi-saia-plugin) — SAIA provider for pi coding agent

## What It Does

At OpenCode startup the plugin registers the `saia` provider and exposes every
SAIA model to the model picker:

1. Fetches the live model list from the SAIA API once per session (disk-cached
   with a 24 h TTL) and registers each model under the `saia/` prefix.
2. Registers the models through the V1 plugin API (`config` hook); name,
   attachment and tool options are derived from the API response itself, so a
   changed SAIA line-up needs no plugin update.
3. Adds a TUI quota widget that shows live rate-limit remaining in the
   `session_prompt_right` slot.

The bundled shell scripts (`src/generate-saia-config.sh`,
`src/copy-saia-config.sh`) remain for the standalone/manual path that writes a
static `opencode.json`.

## 🔄 Auto-Sync Feature

Models are automatically fetched from the SAIA API. To sync the latest models:

```bash
export SAIA_API_KEY=your_key
./scripts/sync-saia-models.sh
```

See [`scripts/README.md`](scripts/README.md) for details on automation and force-include options.

## 🧹 Cleanup Stale Models

To reconcile all providers against their live `/v1/models` and remove obsolete models:

```bash
npm run prune-stale              # dry-run
npm run prune-stale -- --write   # apply (or directly via CLI)
# or via global install
npx opencode-saia-plugin --dry-run
```

See [Usage](#usage) for CLI details.

## Installation

Requires: OpenCode itself plus a `SAIA_API_KEY`. (`curl`/`jq` are only needed
for the optional shell-script path.)

### Recommended: install script

```bash
git clone https://github.com/tobias-weiss-ai-xr/opencode-saia-plugin.git
cd opencode-saia-plugin
bash install.sh
```

`install.sh` copies the runtime into `~/.config/opencode/plugins/saia/`,
installs the OpenCode entry point at
`~/.config/opencode/plugins/saia-plugin.ts`, and registers the TUI quota widget
in `tui.json`. Pass
`--transport responses` to use the Responses API instead of the default Chat
Completions transport. Set `OPENCODE_CONFIG_DIR` first to install somewhere other
than `~/.config/opencode`.

Then set your API key (or configure `apiKeyCommand`, see below):

```bash
echo 'export SAIA_API_KEY="your_key_here"' >> ~/.bashrc
source ~/.bashrc
```

**Windows PowerShell:** run the same `install.sh` from Git Bash/WSL, and persist
the key with
`[Environment]::SetEnvironmentVariable("SAIA_API_KEY", "your_key_here", "User")`.

### Manual install

OpenCode only auto-discovers `plugins/*.{ts,js}` (non-recursively), so the entry
point must live directly under `plugins/`. To mirror what `install.sh` does:

```bash
DEST=~/.config/opencode/plugins
mkdir -p "$DEST"
cp -r src "$DEST/saia"
cp src/saia-plugin.ts src/saia-limits-tui.tsx "$DEST/"
```

### Quick Install (One-liner)

**Linux/macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/tobias-weiss-ai-xr/opencode-saia-plugin/main/install.sh | bash
```

**Windows PowerShell:**
```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tobias-weiss-ai-xr/opencode-saia-plugin/main/install.ps1" -UseBasicParsing | Invoke-Expression
```

### Interactive Setup Wizard

For first-time users, the interactive wizard guides you through the entire setup:

```bash
bash src/setup-wizard.sh
```

The wizard will:
1. **Validate your SAIA API key** against the live API
2. **Select a profile** (production / development / budget)
3. **Install plugin files** to `~/.config/opencode/plugins/saia/`
4. **Generate config** with your chosen profile
5. **Persist your API key** in your shell config (`.bashrc` / `.zshrc`)

### Rate Limits & Live Quota Counter

The plugin reads SAIA rate-limit headers (`x-ratelimit-remaining-*`) in the background and displays live quota remaining in the OpenCode TUI prompt bar:

```text
27/m · 117/h · 519/d · 2.5k/mo
```

### Transport Selection

The plugin supports two SAIA API transports:
- **Chat Completions API** (`chat-completions`, default): uses `@ai-sdk/openai-compatible` targeting `/v1/chat/completions`. Recommended for standard OpenCode workflows, tool calling, and maximum model compatibility.
- **Responses API** (`responses`): uses `@ai-sdk/openai` targeting `/v1/responses`. Useful when routing through API gateways or proxies that mandate the OpenAI Responses API format.

#### Switching Transport for Installed Plugin
If the plugin is already installed in `~/.config/opencode/plugins/saia`, switch transport dynamically at any time:
```bash
node src/set-saia-transport.mjs responses
node src/set-saia-transport.mjs chat-completions
```

#### Specifying Transport During Initial Installation
Pass `--transport` when running the installer:
```bash
bash install.sh --transport responses
```

### API Key Command

Instead of storing plain-text API keys in environment variables or configuration files, you can configure `"apiKeyCommand"` in `~/.config/opencode/saia.json` to fetch your key dynamically from a password manager or CLI utility:

```json
{
  "apiKeyCommand": ["op", "read", "op://Personal/SAIA/credential"]
}
```

Common examples:
- **1Password CLI**: `["op", "read", "op://Personal/SAIA/credential"]`
- **macOS Keychain**: `["security", "find-generic-password", "-a", "username", "-s", "saia_api_key", "-w"]`
- **Bitwarden CLI**: `"bw get notes saia-api-key"`
- **pass (Password Store)**: `"pass show saia/api-key"`

When configured, the plugin executes the command on startup to retrieve your key securely in memory without persisting it to disk.

### LiteLLM Proxy (Optional)

If you have a LiteLLM proxy running (e.g., with SAIA models configured), you can route all requests through it for caching, rate limiting, and fallback support:

```bash
export LITELLM_PROXY_URL=http://your-proxy:4000/v1
```

Then regenerate the config. The plugin will use the proxy URL instead of the direct SAIA API. Start OpenCode in any project — the plugin runs automatically on startup.

## Quick Start

```bash
# Automatic (plugin): just start opencode
opencode

# Manual: generate + copy
cd src
./generate-saia-config.sh   # fetches models, updates master config
./copy-saia-config.sh       # copies to current directory
```

Restart OpenCode after generating the config.

## Available Models

### 🆕 Latest: Qwen3.8 (August 2026)

The plugin now includes the latest Qwen3.8 family:

| Model | Context | Output | Features |
|---|---|---|---|
| **qwen3.8-2.4t-a95b** | 256K | 64K | Flagship reasoning, MoE 2.4T/95B active |
| **qwen3.8-27b** | 128K | 32K | Vision support, Max-class performance |

### Full Model List

The plugin includes 18 SAIA models, fetched live from the API and categorized automatically:

| Category | Models | Description |
|---|---|---|
| **Reasoning** | Qwen3.5 397B/122B, Qwen3-30B | Chain-of-thought models with `can_reason: true` in config |
| **Coder** | Qwen3 Coder Next | Code-specialized models |
| **Vision** | Qwen3.6 35B, Gemma 4 31B, Qwen3 Omni 30B, MedGemma 27B | Vision/multimodal models with `attachment: true` |
| **Agentic** | GLM-4.7, Devstral 2 123B, Mistral Medium 3.5 128B | Strong tool-use and agentic coding |
| **Large Context** | OpenAI GPT-OSS 120B, Mistral Medium 3.5 128B | 128k+ context windows |
| **General** | Qwen3.6 27B, Qwen3 30B, DeepSeek V4 Flash, Apertus 70B, Llama 3.1 8B, etc. | General-purpose models |

Default model: `saia/glm-5.3-flash`

Models marked with `can_reason: true` enable OpenCode's reasoning mode (chain-of-thought). Use `/model` in OpenCode to switch models.

### Model Aliases

The plugin generates convenience aliases for quick model selection without memorizing IDs:

| Alias | Points To | Use Case |
|---|---|---|
| `saia/best-for-coding` | qwen3-coder-next | Code-specialized tasks |
| `saia/best-for-reasoning` | qwen3.8-2.4t-a95b | Complex reasoning, math, planning |
| `saia/best-for-vision` | qwen3.8-27b | Image analysis, multimodal |
| `saia/best-for-agentic` | glm-5.3-flash | Agentic coding, tool use |
| `saia/best-quality` | qwen3.8-2.4t-a95b | Highest quality output |
| `saia/fastest-reasoning` | qwen3.8-27b | Fast reasoning with vision |
| `saia/fastest` | meta-llama-3.1-8b | Fastest response time |
| `saia/budget` | deepseek-v4-flash-0731 | Lowest cost |

Usage in OpenCode: `/model saia/best-for-coding`

Aliases are profile-aware: only included if the target model is available in the current profile.

### Model Properties

Each model in the generated config may include these special fields:

| Field | Values | Description |
|---|---|---|
| `can_reason` | `true` | Enables chain-of-thought reasoning mode in OpenCode |
| `attachment` | `true` | Allows image/file input (vision models only) |
| `limit.context` | `32768` / `128000` / `131072` | Context window size in tokens |
| `limit.output` | `4096` / `8192` / `16384` / `32768` | Max output tokens per model |

Most models have 128k context windows. Vision, medical, and research models use 32k.

## Rate Limits

SAIA enforces the following rate limits (shared across all models):

- **30 requests/min** · **200/hour** · **1,000/day** · **3,000/month**

When limits are exhausted, the API returns 429 errors. Check remaining quota at the [SAIA dashboard](https://chat-ai.academiccloud.de).

## Benchmarking

To benchmark a model via the SAIA API:

```bash
curl -s -w "\nTime: %{time_total}s\n" \
  "https://chat-ai.academiccloud.de/v1/chat/completions" \
  -H "Authorization: Bearer $SAIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-5.3-flash",
    "messages": [{"role": "user", "content": "Explain async/await in JavaScript in 3 sentences."}],
    "max_tokens": 200
  }' | jq '.usage'
```

Metrics to track: `time_total` (latency), `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`.

## Troubleshooting

| Problem | Diagnosis | Fix |
|---|---|---|
| No `saia/*` models appear | Plugin not discovered | Check `~/.config/opencode/plugins/saia-plugin.ts` exists and `echo $SAIA_API_KEY` |
| "NO API KEY SET" warning | Key not visible to OpenCode | Export `SAIA_API_KEY` or set `apiKeyCommand` in `~/.config/opencode/saia.json` |
| Plugin fails with API error | Invalid key or network issue | Verify the key at [SAIA dashboard](https://chat-ai.academiccloud.de), check firewall |
| `curl: command not found` | Missing `curl` | Install: Linux `sudo apt install curl` or macOS `brew install curl` |
| `jq: command not found` | Missing `jq` | Install: Linux `sudo apt install jq` or macOS `brew install jq` |
| 429 errors | Rate limit exhausted | Wait or check dashboard quota |
| Quota widget missing | TUI plugin not registered | Re-run `bash install.sh` — it registers `saia-limits-tui.tsx` in `cli.json`/`tui.json` |

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `SAIA_API_KEY` | Yes | API key for GWDG Chat AI service |
| `LITELLM_PROXY_URL` | No | Optional LiteLLM proxy URL for caching/rate limiting |
| `SAIA_CACHE_L0` | No | L0 in-memory cache: `true` (default) or `false` to disable |
| `SAIA_CACHE_L1` | No | L1 disk cache: `true` (default) or `false` to disable |

## Relationship to the Original GWDG Plugin

This project began as a fork of the original SAIA plugin by jlewis/GWDG (GitLab)
and has since diverged into a native OpenCode plugin rather than an
`opencode.json` generator.

| Aspect | This plugin | Original GWDG (GitLab) |
|--------|-------------|------------------------|
| **Integration** | Native OpenCode plugin that registers the `saia` provider at runtime | Bash + Node.js scripts that generate a static `opencode.json` |
| **Plugin API** | V1 plugin: `config` hook + `server()` | V1 `config` hook |
| **Model data** | Live `/v1/models` fetch, disk-cached (24 h TTL), metadata derived from the API response | Scripts that write config on demand |
| **Extras** | TUI quota widget, L0/L1 cache, usage metrics, model aliases, transport switch | — |

The shell scripts under `src/` (`generate-saia-config.sh`,
`copy-saia-config.sh`, `validate-config.sh`, …) are retained for the
manual/static path. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the internals.

**Repositories:** development happens on GitHub; the Codeberg remote is a
periodically synced mirror (the machine-readable catalog is served from
Codeberg — see above). The GitLab remote is the upstream reference.

## Configuration Validation

The plugin includes JSON schema validation to catch configuration errors early. Validate your `opencode.json` before using it:

```bash
# Validate current project configuration
bash src/validate-config.sh opencode.json

# Validate global OpenCode config
bash src/validate-config.sh ~/.config/opencode/opencode.json
```

**Requirements:**
- `ajv-cli` (recommended): `npm install -g ajv-cli` (full schema validation)
- `jq` (fallback): `apt install jq` or `brew install jq` (basic structure checks)

**Features:**
- Validates required fields (`provider`, `model`, `apiKey`)
- Checks model format (`saia/` prefix)
- Validates API key reference (must reference `SAIA_API_KEY`)
- Checks model config structure (`name`, `options`, `limit`)
- Validates new metadata fields (`cost_per_1k_tokens`, `estimated_latency`, `recommended_for`)

If validation fails, the script will show detailed error messages to help you fix the configuration issues.

## Files

| File | Purpose |
|---|---|
| `install.sh` / `install.ps1` | One-command installers (Linux/macOS, Windows) |
| `src/install-runtime.mjs` | Copies the runtime + entry point into `~/.config/opencode/plugins/` |
| `src/runtime-manifest.mjs` | Single source of truth for the installed file set |
| `src/install-tui-config.mjs` | Registers the TUI widget in `tui.json` |
| `src/saia-plugin.ts` | OpenCode discovery entry point (re-exports the plugin) |
| `src/saia.ts` | Plugin: model loader, provider registration, config hook |
| `src/saia-limits-server.js` | Captures `x-ratelimit-remaining-*` headers |
| `src/saia-limits-tui.tsx` | TUI quota widget (`session_prompt_right` slot) |
| `src/saia-memory.ts` | L0/L1 cache, usage tracking, metrics, preferences |
| `src/saia-api-key.mjs` | API-key resolution (env var / `apiKeyCommand` / settings) |
| `src/saia-transport.mjs`, `src/set-saia-transport.mjs` | Transport selection (chat-completions / responses) |
| `src/saia-config.mjs`, `src/saia-model-metadata.js` | Model-response parsing and per-model metadata |
| `src/saia-system-messages.js` | Qwen system-message normalization |
| `src/setup-wizard.sh` | Interactive first-time setup wizard (validates the API key) |
| `src/generate-saia-config.sh` | Shell path: fetch models → master config |
| `src/copy-saia-config.sh` | Shell path: copy the master config into a project |
| `src/validate-config.sh` | JSON-schema validator for `opencode.json` |
| `src/opencode-saia.json` | Generated master configuration used by the shell path |
| `.opencode/skills/*.md` | SAIA skills: `saia-refresh`, `saia-health`, `saia-optimize`, `saia-switch-profile`, `saia-memory-clear` |
| `schema/opencode.schema.json` | JSON schema for configuration validation |
| `opencode.json.example` | Example `opencode.json` for reference |
| `LICENSE` | MIT License |

## License

See [LICENSE](LICENSE) in this repository.
