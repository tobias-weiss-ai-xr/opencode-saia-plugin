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
- [pi-l1-cache](https://github.com/tobias-weiss-ai-xr/pi-l1-cache) — Optional L1 caching for pi

## What It Does

1. Fetches the latest model list from the SAIA API
2. Generates an `opencode.json` with all SAIA models, properly categorized
3. Copies it to your project directory so OpenCode picks it up

## 🔄 Auto-Sync Feature

Models are automatically fetched from the SAIA API. To sync the latest models:

```bash
export SAIA_API_KEY=your_key
./scripts/sync-saia-models.sh
```

See [`scripts/README.md`](scripts/README.md) for details on automation and force-include options.

### Machine-Readable Model Catalog (`data/saia-models.json`)

Facts are collected automatically — no manual table maintenance:

```bash
node scripts/collect-saia-model-info.mjs   # merges 3 sources → data/saia-models.json
```

1. **Live API** (`/v1/models`) → ids, status, input/output modalities
2. **GWDG docs table** → context windows, release dates, recommended sampling, org
3. [`scripts/reasoning-models.json`](scripts/reasoning-models.json) → reasoning API params per family (curated, with vendor sources; the collector flags any live model without an entry)

The result is a clean, unopinionated catalog — one curl gets you every SAIA model
with context size, modalities and reasoning controls, reusable by any client:

```bash
curl -s https://codeberg.org/graphwiz-ai/opencode-saia-plugin/raw/branch/main/data/saia-models.json
```

Only output limits, cost/latency estimates, categories and aliases remain
opinionated (they live in `scripts/sync-saia-models.sh` / `src/generate-saia-config.sh`).

## Installation

Requires: `SAIA_API_KEY`, `curl`, `jq`

```bash
# Clone
git clone https://codeberg.org/graphwiz-ai/opencode-saia-plugin.git
cd opencode-saia-plugin

# Install as OpenCode plugin
mkdir -p ~/.config/opencode/plugins
cp -r src ~/.config/opencode/plugins/saia
chmod +x ~/.config/opencode/plugins/saia/generate-saia-config.sh
chmod +x ~/.config/opencode/plugins/saia/copy-saia-config.sh

# Set your API key (Linux/macOS - permanent)
echo 'export SAIA_API_KEY="your_key_here"' >> ~/.bashrc
source ~/.bashrc
```

**Windows PowerShell:**
```powershell
git clone https://codeberg.org/graphwiz-ai/opencode-saia-plugin.git
cd opencode-saia-plugin
cp -r src $HOME\.config\opencode\plugins\saia
[Environment]::SetEnvironmentVariable("SAIA_API_KEY", "your_key_here", "User")
```

### Quick Install (One-liner)

**Linux/macOS:**
```bash
curl -fsSL https://codeberg.org/graphwiz-ai/opencode-saia-plugin/raw/branch/master/install.sh | bash
```

**Windows PowerShell:**
```powershell
Invoke-WebRequest -Uri "https://codeberg.org/graphwiz-ai/opencode-saia-plugin/raw/branch/master/install.ps1" -UseBasicParsing | Invoke-Expression
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

14 SAIA models, synced from the live API with context windows from the
[GWDG docs](https://docs.hpc.gwdg.de/services/ai-services/chat-ai/models/index.html):

| Model | Context | Output | Reasoning | Vision | Category |
|---|---|---|---|---|---|
| `saia/apertus-70b-instruct-2509` | 65K | 16K | — | — | general |
| `saia/deepseek-v4-flash-0731` | 1M | 32K | ✅ | — | reasoning |
| `saia/devstral-2-123b-instruct-2512` | 256K | 16K | — | — | agentic |
| `saia/gemma-4-31b-it` | 256K | 8K | — | ✅ | vision |
| `saia/glm-5.3-flash` | 1M | 32K | ✅ | ✅ | agentic |
| `saia/meta-llama-3.1-8b-instruct` | 128K | 8K | — | — | general |
| `saia/mistral-medium-3.5-128b` | 256K | 8K | — | — | agentic |
| `saia/openai-gpt-oss-120b` | 128K | 8K | ✅ | — | reasoning |
| `saia/qwen3-30b-a3b-instruct-2507` | 256K | 16K | — | — | reasoning |
| `saia/qwen3-coder-next` | 256K | 16K | — | — | coder |
| `saia/qwen3-omni-30b-a3b-instruct` | 256K | 16K | — | ✅ | vision |
| `saia/qwen3.5-397b-a17b` | 256K | 32K | ✅ | ✅ | reasoning |
| `saia/qwen3.6-35b-a3b` | 262K | 16K | ✅ | ✅ | reasoning |
| `saia/qwen3.8-27b` | 262K | 16K | ✅ | — | reasoning |

Default model: `saia/deepseek-v4-flash-0731` — 1M context, reasoning-capable.

### Model Aliases

| Alias | Points To | Use Case |
|---|---|---|
| `saia/best-for-coding` | `qwen3-coder-next` | Code-specialized tasks |
| `saia/best-for-reasoning` | `qwen3.5-397b-a17b` | Complex reasoning, math, planning |
| `saia/best-quality` | `qwen3.5-397b-a17b` | Highest quality output |
| `saia/best-for-vision` | `qwen3.8-27b` | Image analysis, multimodal |
| `saia/best-for-agentic` | `glm-5.3-flash` | Agentic coding, tool use |
| `saia/fastest` | `meta-llama-3.1-8b-instruct` | Fastest response time |
| `saia/fastest-reasoning` | `qwen3.8-27b` | Fast reasoning |
| `saia/budget` | `deepseek-v4-flash-0731` | Lowest cost |

Usage: `/model saia/best-for-coding`

Aliases are regenerated by the sync script and always point at live models.

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
| Plugin not creating `opencode.json` | Script not found or not executable | Run `ls ~/.config/opencode/plugins/saia/` and `echo $SAIA_API_KEY` |
| Script fails with API error | Invalid key or network issue | Verify API key at [SAIA dashboard](https://chat-ai.academiccloud.de), check firewall |
| `curl: command not found` | Missing `curl` | Install: Linux `sudo apt install curl` or macOS `brew install curl` |
| `jq: command not found` | Missing `jq` | Install: Linux `sudo apt install jq` or macOS `brew install jq` |
| 429 errors | Rate limit exhausted | Wait or check dashboard quota |
| Models not showing in OpenCode | Outdated config | Restart OpenCode after running `generate-saia-config.sh` |
| Plugin not loading | Wrong plugin registration | Check `~/.config/opencode/opencode.json` has `"plugin": ["saia"]` |

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `SAIA_API_KEY` | Yes | API key for GWDG Chat AI service |
| `LITELLM_PROXY_URL` | No | Optional LiteLLM proxy URL for caching/rate limiting |
| `SAIA_CACHE_L0` | No | L0 in-memory cache: `true` (default) or `false` to disable |
| `SAIA_CACHE_L1` | No | L1 disk cache: `true` (default) or `false` to disable |

## Comparison with Original GWDG Plugin

This fork (Codeberg/graphwiz-ai) is based on the original SAIA plugin by jlewis/GWDG (GitLab-ce) but has diverged with additional features and different approach priorities.

| Aspect | This Fork (Codeberg) | Upstream (GitLab) | bleedingEdge Branch |
|--------|----------------------|-------------------|-------------------|
| **Architecture** | Bash shell scripts (`generate-saia-config.sh`, `copy-saia-config.sh`) | Bash + Node.js (`generate-saia-config.mjs`) | Native Node.js plugin (`saia.ts`) |
| **Plugin `saia.ts`** | Calls shell scripts (simple, portable) | Native Node.js plugin (auto-refresh from API each launch) | Native Node.js plugin + memory layer (`fetchWithCache`, metrics, preferences) |
| **Model generation** | Shell: `curl` + `jq` curated categorizations; internal `gitlab/master` reference | Bash scripts; optionally Node.js; uses `fetch()` for live API calls | Live API fetch with 24h TTL cache; metrics and usage tracking; per-project context learning |
| **Model metadata** | Rich: `can_reason`, `attachment`, `limit.context`, `limit.output`, curated categorization | Adds `options.enable-auto-tool-choice`, `options.tool-call-parser` per model | Same rich metadata as master + project-specific preferences learned from usage |
| **Provider options** | `options.baseURL`, `apiKey` | Adds then removes `options.headers.inference-service: "saia-openai-gateway"` | Same as master, plus sync with profile switches (production/dev/budget) |
| **Installation** | `install.sh`/`install.ps1` (adapted for Codeberg URLs); optional `LITELLM_PROXY_URL` | `install.sh`/`install.ps1` (Auto-configures `opencode.json` on first install); optional profile support | Same as master + `.opencode/skills/` directory |
| **Dedicated docs** | README Sections: Pre-setup, What It Does, Available Models (categories table), Benchmarking, Troubleshooting, Files, Environment Variables, License | README Sections: shorter docs; fewer documented environment variables | All master docs + Memory Layer and SAIA Skills sections + Ref to bleedingEdge features |
| **Files** | `generate-saia-config.sh`, `copy-saia-config.sh`, `generate-saia-config.mjs` (not present/unused in this fork) | `generate-saia-config.mjs`, `generate-saia-config.sh` (older version) | Adds `src/saia-memory.ts`, `.opencode/skills/*.md` skills files, `package.json`, `tsconfig.json` |
| **Features** | Model categories: Reasoning, Coder, Vision, Medical, Research, Agentic, Large Context, General; per-model metadata; `.editorconfig`, `LICENSE`, `.gitignore`; JSON validation | Cross-platform Node.js scripts; config-level `formatter: {}`; auto-refresh on launch; permissions toggle | All master features + memory layer (cache, metrics, usage, preferences) + five SAIA skills + model optimization/recommendation + health checks |
| **Syncs** | `gitlab/master` mirror retained for reference | Origin | Cherry-picks of master improvements; auto-refresh removed (conflicts with curated metadata) |
| **Commit count since fork** | +13 commits (only in Codeberg) | +16 commits (only in GitLab) | Adds native plugin + memory + skills (staging + commit `c37582b`, commit `68b7c76`) |

**Common History:** Both repos share commits `b7df10c` through `f2c758b` (9 commits). After that, they took different directions:
- **Codeberg**: Enhanced model categorization, added metadata, better installation docs, cherry-picked formatter/option fixes
- **GitLab**: Refactored to native Node.js plugin, added auto-refresh, improved config management

**References:**
- Primary (Codeberg/graphwiz-ai): https://codeberg.org/graphwiz-ai/opencode-saia-plugin · tag: `v0.1.3` · commit: `9478ebf`
- Original (GitLab/jlewis): https://gitlab-ce.gwdg.de/jlewis/opencode-saia-plugin · tag: `v0.1.2` · commit: `8e71b38`

**Why Use This Fork:**
- Cleaner model categorization (Reasoning, Vision, Medical, etc.)
- Per-model metadata (context windows, output limits, reasoning flags)
- Richer documentation (models table, troubleshooting, benchmarking)
- Cross-platform install scripts (Linux/macOS/Windows)
- `.editorconfig` for consistent formatting and `.gitignore` for generated files

**Why Use Original:**
- Native Node.js plugin (no shell dependencies)
- Auto-refresh from SAIA API on each OpenCode launch
- Simpler model config generation

**Best Strategy:** Use this fork for production (richer features) → monitor GitLab for architectural improvements (native plugin, auto-refresh). For bleeding-edge features (memory, skills, optimization), switch to `bleedingEdge` branch.

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
| `src/saia.ts` | OpenCode plugin — master: shell wrapper; `bleedingEdge`: native Node.js plugin |
| `src/saia-memory.ts` | Memory layer utilities (`bleedingEdge` only) - caching, usage tracking, metrics |
| `src/validate-config.sh` | JSON schema validator for opencode.json files |
| `src/setup-wizard.sh` | Interactive first-time setup wizard (validates API key, selects profile) |
| `src/generate-saia-config.sh` | Fetches models from API, generates master config (master branch) |
| `src/copy-saia-config.sh` | Copies master config to project directory (master branch) |
| `src/opencode-saia.json` | Master configuration (generated, 27 models with metadata) |
| `.opencode/skills/` | SAIA skills directory (`bleedingEdge` only) |
| `.opencode/skills/saia-refresh.md` | Force-refresh model list skill |
| `.opencode/skills/saia-health.md` | SAIA API health check skill |
| `.opencode/skills/saia-optimize.md` | Model optimization / recommendation skill |
| `.opencode/skills/saia-switch-profile.md` | Profile switcher skill (production/dev/budget) |
| `.opencode/skills/saia-memory-clear.md` | Clear all SAIA memory skill |
| `schema/opencode.schema.json` | JSON schema for configuration validation |
| `package.json` | Node.js dependencies (`bleedingEdge` only) |
| `tsconfig.json` | TypeScript configuration (`bleedingEdge` only) |
| `install.sh/install.ps1` | One-click installers (Linux/macOS/Windows) |
| `opencode.json.example` | Example opencode.json for reference |
| `LICENSE` | MIT License |

## License

See [LICENSE](LICENSE) in this repository.
