# SAIA Plugin for OpenCode

OpenCode plugin that adds all [SAIA](https://chat-ai.academiccloud.de) (GWDG Chat AI) models to your OpenCode setup.

**Repositories:** [Codeberg](https://codeberg.org/graphwiz-ai/opencode-saia-plugin) · [GitLab](https://gitlab-ce.gwdg.de/jlewis/opencode-saia-plugin)

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
cp -r src ~/.config/opencode/plugins/saia
chmod +x ~/.config/opencode/plugins/saia/generate-saia-config.sh
chmod +x ~/.config/opencode/plugins/saia/copy-saia-config.sh

# Set your API key
export SAIA_API_KEY=your_key_here
```

Then start OpenCode in any project — the plugin runs automatically on startup.

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

Models are fetched live from the SAIA API and categorized automatically:

| Category | Models | Description |
|---|---|---|
| **Reasoning** | Qwen3.5 397B/122B/35B/27B, Qwen3 30B Thinking, DeepSeek R1 70B | Chain-of-thought models with `set_reasoning_content_in_choice` support |
| **Coder** | Qwen3 Coder 30B | Code-specialized models |
| **Vision** | Qwen3 VL 30B, InternVL 3.5 30B | Vision-language models |
| **Medical** | MedGemma 27B | Medical domain specialist |
| **Research** | Teuken 7B, SauerkrautLM 70B | German/European research models |
| **Agentic** | GLM-4.7, Devstral 2 123B | Strong tool-use and agentic coding |
| **Large Context** | Qwen3 235B, Mistral Large 3 675B, GPT-OSS 120B | 128k+ context windows |
| **General** | Llama 3.3 70B, Gemma 3/4, Qwen3 32B, Apertus 70B, etc. | General-purpose models |

Default model: `saia/glm-4.7`

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

| Problem | Fix |
|---|---|
| Plugin not creating `opencode.json` | Check `ls ~/.config/opencode/plugins/saia/` and `echo $SAIA_API_KEY` |
| Script fails | Verify API key, network access to `chat-ai.academiccloud.de`, `curl` and `jq` installed |
| 429 errors | Rate limit hit — wait or check dashboard |
| Models not showing in OpenCode | Restart OpenCode after config generation |

## Files

| File | Purpose |
|---|---|
| `src/saia.ts` | OpenCode plugin — runs on startup |
| `src/generate-saia-config.sh` | Fetches models from API, generates master config |
| `src/copy-saia-config.sh` | Copies master config to project directory |
| `src/opencode-saia.json` | Master configuration (generated) |

## License

See [LICENSE](LICENSE) in this repository.
