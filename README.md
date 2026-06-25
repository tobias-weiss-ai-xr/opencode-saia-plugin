# SAIA Plugin for OpenCode

OpenCode plugin that adds all [SAIA](https://chat-ai.academiccloud.de) (GWDG Chat AI) models to your OpenCode setup.

**Repositories:** 
- **Primary (maintained):** [Codeberg](https://codeberg.org/graphwiz-ai/opencode-saia-plugin) (this repo)
- **Original (reference):** [GitLab](https://gitlab-ce.gwdg.de/jlewis/opencode-saia-plugin) (jlewis/GWDG)

Both repos share a common origin (commit f2c758b) and sync frequently. This Codeberg version focuses on model categorization, rich metadata, and cross-platform installation scripts.

## What It Does

1. Fetches the latest model list from the SAIA API
2. Generates an `opencode.json` with all SAIA models, properly categorized
3. Copies it to your project directory so OpenCode picks it up

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

The plugin includes 27 SAIA models, fetched live from the API and categorized automatically:

| Category | Models | Description |
|---|---|---|
| **Reasoning** | Qwen3.5 397B/122B/35B/27B, Qwen3 30B Thinking, DeepSeek R1 70B, GLM-4.7, Qwen3 235B | Chain-of-thought models with `can_reason: true` in config |
| **Coder** | Qwen3 Coder 30B | Code-specialized models |
| **Vision** | Qwen3 VL 30B, InternVL 3.5 30B, Qwen3 Omni 30B | Vision-language models with `attachment: true` for image/file input |
| **Medical** | MedGemma 27B | Medical domain specialist |
| **Research** | Teuken 7B, SauerkrautLM 70B | German/European research models |
| **Agentic** | GLM-4.7, Devstral 2 123B | Strong tool-use and agentic coding |
| **Large Context** | Qwen3 235B, Mistral Large 3 675B, GPT-OSS 120B | 128k+ context windows |
| **General** | Llama 3.3 70B, Gemma 3/4, Qwen3 32B, Apertus 70B, etc. | General-purpose models |

Default model: `saia/glm-4.7`

Models marked with `can_reason: true` enable OpenCode's reasoning mode (chain-of-thought). Use `/model` in OpenCode to switch models.

### Model Aliases

The plugin generates convenience aliases for quick model selection without memorizing IDs:

| Alias | Points To | Use Case |
|---|---|---|
| `saia/best-for-coding` | qwen3-coder-30b | Code-specialized tasks |
| `saia/best-for-reasoning` | deepseek-r1-70b | Complex reasoning, math, planning |
| `saia/best-for-vision` | internvl3.5-30b | Image analysis, multimodal |
| `saia/best-for-agentic` | glm-4.7 | Agentic coding, tool use |
| `saia/best-quality` | qwen3.5-397b | Highest quality output |
| `saia/fastest` | llama-3.1-8b | Fastest response time |
| `saia/budget` | llama-3.1-8b | Lowest cost |
| `saia/best-german` | sauerkrautlm-70b | German language tasks |

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
    "model": "glm-4.7",
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
