#!/usr/bin/env bash
set -euo pipefail

# SAIA Configuration Manager
# Fetches latest SAIA models from GWDG Chat AI API and generates opencode.json
# Uses curated model knowledge for accurate categorization and descriptions.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MASTER_CONFIG="$SCRIPT_DIR/opencode-saia.json"

SAIA_API_KEY="${SAIA_API_KEY:-}"

# LiteLLM proxy support — if LITELLM_PROXY_URL is set, use the proxy instead of direct SAIA API
LITELLM_PROXY_URL="${LITELLM_PROXY_URL:-}"
USE_PROXY=false
if [[ -n "$LITELLM_PROXY_URL" ]]; then
    USE_PROXY=true
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

if [[ -z "$SAIA_API_KEY" ]]; then
    print_error "SAIA_API_KEY environment variable not set"
    print_info "Get one at: https://chat-ai.academiccloud.de"
    print_info "Then: export SAIA_API_KEY=your_key"
    exit 1
fi

if [[ "$USE_PROXY" == "true" ]]; then
    print_info "Using LiteLLM proxy at: $LITELLM_PROXY_URL"
fi

API_BASE_URL="${LITELLM_PROXY_URL:-https://chat-ai.academiccloud.de/v1}"

print_info "Fetching latest SAIA models..."

MODELS_JSON=$(curl -s --max-time 30 "${API_BASE_URL}/models" \
    -H "Authorization: Bearer $SAIA_API_KEY")

if [[ -z "$MODELS_JSON" ]] || ! echo "$MODELS_JSON" | jq -e '.data' >/dev/null 2>&1; then
    print_error "Failed to fetch models from SAIA API"
    print_info "Check: SAIA_API_KEY is valid, and you have network access to chat-ai.academiccloud.de"
    exit 1
fi

MODEL_COUNT=$(echo "$MODELS_JSON" | jq -r '.data | length')
print_info "Found $MODEL_COUNT SAIA models"

if [[ -f "$MASTER_CONFIG" ]]; then
    OLD_COUNT=$(jq -r '.provider.saia.models | length' "$MASTER_CONFIG" 2>/dev/null || echo "0")
    if [[ "$OLD_COUNT" == "$MODEL_COUNT" ]]; then
        print_info "Master configuration is up to date ($MODEL_COUNT models)"
    else
        print_info "Updating master configuration ($OLD_COUNT -> $MODEL_COUNT models)"
    fi
else
    print_info "Creating master configuration with $MODEL_COUNT models"
fi

# --- Model categorization ---
# Uses curated knowledge from LiteLLM proxy config and model specs.
# Categories:
#   reasoning     - Chain-of-thought / thinking models (set_reasoning_content_in_choice in LiteLLM)
#   coder         - Code-specialized models
#   vision        - Vision-language models
#   medical       - Medical domain models
#   research      - Research/academic models
#   agentic       - Strong tool-use / agentic coding models
#   large-context - Models with 128k+ context windows
#   general       - Everything else

categorize() {
    local id="$1"
    case "$id" in
        *thinking*|*r1*|deepseek-r1*)
            echo "reasoning"
            ;;
        *coder*)
            echo "coder"
            ;;
        *vl-*|*vision*|internvl*)
            echo "vision"
            ;;
        medgemma*)
            echo "medical"
            ;;
        teuken*|sauerkraut*)
            echo "research"
            ;;
        glm-4.7|devstral*)
            echo "agentic"
            ;;
        *120b|*235b|*675b|mistral-large*)
            echo "large-context"
            ;;
        *)
            echo "general"
            ;;
    esac
}

describe() {
    local id="$1"
    local cat="$2"
    case "$id" in
        qwen3.5-397b-a17b)       echo "Qwen3.5 397B MoE (128k ctx) — Flagship reasoning, best quality" ;;
        qwen3.5-122b-a10b)       echo "Qwen3.5 122B MoE (128k ctx) — Strong reasoning, fast" ;;
        qwen3.5-35b-a3b)         echo "Qwen3.5 35B MoE (128k ctx) — Fast reasoning" ;;
        qwen3.5-27b)             echo "Qwen3.5 27B Dense (128k ctx) — Efficient reasoning" ;;
        qwen3.6-35b-a3b)         echo "Qwen3.6 35B MoE — Vision, reasoning, agentic coding" ;;
        qwen3-235b-a22b)         echo "Qwen3 235B MoE (128k ctx) — Large context, strong generalist" ;;
        qwen3-32b)               echo "Qwen3 32B Dense (128k ctx) — Balanced" ;;
        qwen3-coder-30b-a3b-instruct) echo "Qwen3 Coder 30B — Code-specialized" ;;
        qwen3-omni-30b-a3b-instruct) echo "Qwen3 Omni 30B — Multimodal (text+audio)" ;;
        qwen3-vl-30b-a3b-instruct)   echo "Qwen3 VL 30B — Vision-language" ;;
        qwen3-30b-a3b-thinking-2507) echo "Qwen3 30B Thinking — Chain-of-thought reasoning" ;;
        qwen3-30b-a3b-instruct-2507) echo "Qwen3 30B Instruct — General purpose" ;;
        mistral-large-3-675b-instruct-2512) echo "Mistral Large 3 675B (128k ctx) — Largest model, strong generalist" ;;
        openai-gpt-oss-120b)     echo "OpenAI GPT-OSS 120B — Large context model" ;;
        devstral-2-123b-instruct-2512) echo "Devstral 2 123B — Mistral's agentic coder" ;;
        glm-4.7)                 echo "GLM-4.7 (128k ctx) — Agentic coding, strong tool use" ;;
        deepseek-r1-distill-llama-70b) echo "DeepSeek R1 Distill 70B — Reasoning (Llama base)" ;;
        gemma-3-27b-it)          echo "Gemma 3 27B — Google lightweight model" ;;
        gemma-4-31b-it)          echo "Gemma 4 31B — Google latest" ;;
        llama-3.3-70b-instruct)  echo "Llama 3.3 70B — Meta strong generalist" ;;
        llama-3.1-8b-instruct)   echo "Llama 3.1 8B — Meta fast lightweight" ;;
        apertus-70b-instruct-2509) echo "Apertus 70B — Open-source instruct model" ;;
        internvl3.5-30b-a3b)     echo "InternVL 3.5 30B — Vision-language" ;;
        medgemma-27b-it)         echo "MedGemma 27B — Medical domain specialist" ;;
        teuken-7b-instruct-research) echo "Teuken 7B — German research model" ;;
        llama-3.1-sauerkrautlm-70b-instruct) echo "SauerkrautLM 70B — German-enhanced Llama" ;;
        meta-llama-3.1-8b-instruct) echo "Llama 3.1 8B — Meta lightweight" ;;
        *)
            # Fallback: capitalize category
            echo "$id — $(echo "$cat" | sed 's/.*/\u&/')"
            ;;
    esac
}

can_reason() {
    local id="$1"
    case "$id" in
        *thinking*|*r1*|deepseek-r1*|qwen3.5-397b-a17b|qwen3.5-122b-a10b|qwen3.5-35b-a3b|qwen3.5-27b|qwen3.6-35b-a3b|glm-4.7|qwen3-235b-a22b|qwen3-30b-a3b-instruct-2507)
            echo "true"
            ;;
        *)
            echo "false"
            ;;
    esac
}

get_context_window() {
    local id="$1"
    case "$id" in
        qwen3.5-397b-a17b|qwen3.5-122b-a10b|qwen3.5-35b-a3b|qwen3.5-27b|qwen3.6-35b-a3b|qwen3-235b-a22b|qwen3-32b|mistral-large-3-675b-instruct-2512|glm-4.7|llama-3.3-70b-instruct|llama-3.1-8b-instruct|llama-3.1-sauerkrautlm-70b-instruct|meta-llama-3.1-8b-instruct|apertus-70b-instruct-2509|devstral-2-123b-instruct-2512|openai-gpt-oss-120b|deepseek-r1-distill-llama-70b)
            echo "128000"
            ;;
        gemma-3-27b-it|gemma-4-31b-it|qwen3-coder-30b-a3b-instruct|qwen3-30b-a3b-instruct-2507|qwen3-30b-a3b-thinking-2507)
            echo "131072"
            ;;
        qwen3-vl-30b-a3b-instruct|internvl3.5-30b-a3b|medgemma-27b-it|qwen3-omni-30b-a3b-instruct|teuken-7b-instruct-research)
            echo "32768"
            ;;
        *)
            echo "128000"
            ;;
    esac
}

supports_attachment() {
    local id="$1"
    case "$id" in
        qwen3-vl-30b-a3b-instruct|internvl3.5-30b-a3b|qwen3.6-35b-a3b|qwen3-omni-30b-a3b-instruct)
            echo "true"
            ;;
        *)
            echo "false"
            ;;
    esac
}

get_output_window() {
    local id="$1"
    case "$id" in
        qwen3.5-397b-a17b|qwen3.5-122b-a10b|qwen3.6-35b-a3b|mistral-large-3-675b-instruct-2512|qwen3-235b-a22b)
            echo "32768"
            ;;
        qwen3.5-35b-a3b|qwen3.5-27b|glm-4.7|devstral-2-123b-instruct-2512|qwen3-32b|qwen3-coder-30b-a3b-instruct|deepseek-r1-distill-llama-70b)
            echo "16384"
            ;;
        qwen3-30b-a3b-instruct-2507|qwen3-30b-a3b-thinking-2507)
            echo "16384"
            ;;
        gemma-3-27b-it|gemma-4-31b-it|llama-3.3-70b-instruct|apertus-70b-instruct-2509|openai-gpt-oss-120b)
            echo "8192"
            ;;
        internvl3.5-30b-a3b|qwen3-vl-30b-a3b-instruct|qwen3-omni-30b-a3b-instruct|medgemma-27b-it)
            echo "4096"
            ;;
        teuken-7b-instruct-research|llama-3.1-sauerkrautlm-70b-instruct|llama-3.1-8b-instruct|meta-llama-3.1-8b-instruct)
            echo "4096"
            ;;
        *)
            echo "8192"
            ;;
    esac
}

print_info "Generating opencode.json..."

cat > "$MASTER_CONFIG" <<'HEADER'
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": "allow",
    "edit": "allow",
    "read": "allow",
    "grep": "allow",
    "glob": "allow",
    "list": "allow",
    "lsp": "allow",
    "skill": "allow",
    "task": "allow",
    "todowrite": "allow",
    "todoread": "allow",
    "webfetch": "allow",
    "websearch": "allow",
    "codesearch": "allow",
    "question": "allow",
    "mymcp_*": "ask"
  },
  "model": "saia/glm-4.7",
  "provider": {
    "saia": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "SAIA (GWDG Chat AI)",
      "options": {
        "baseURL": "https://chat-ai.academiccloud.de/v1",
        "apiKey": "{env:SAIA_API_KEY}"
      },
      "models": {
HEADER

FIRST=true
echo "$MODELS_JSON" | jq -r '.data[].id' | sort | while read -r model_id; do
    [[ -z "$model_id" ]] && continue
    cat=$(categorize "$model_id")
    desc=$(describe "$model_id" "$cat")

    if [[ "$FIRST" == "true" ]]; then
        FIRST=false
    else
        echo "," >> "$MASTER_CONFIG"
    fi

    reason_flag=$(can_reason "$model_id")
    attach_flag=$(supports_attachment "$model_id")
    ctx=$(get_context_window "$model_id")
    out=$(get_output_window "$model_id")

    fields="\"name\": \"$desc\""
    [[ "$reason_flag" == "true" ]] && fields="$fields, \"can_reason\": true"
    [[ "$attach_flag" == "true" ]] && fields="$fields, \"attachment\": true"
    fields="$fields, \"limit\": {\"context\": $ctx, \"output\": $out}"

    printf '        "%s": {%s}' "$model_id" "$fields" >> "$MASTER_CONFIG"
done

cat >> "$MASTER_CONFIG" <<'FOOTER'

      }
    }
  }
}
FOOTER

if [[ "$USE_PROXY" == "true" ]]; then
    sed -i "s|https://chat-ai.academiccloud.de/v1|${LITELLM_PROXY_URL}|g" "$MASTER_CONFIG"
    print_info "Configured to use LiteLLM proxy: $LITELLM_PROXY_URL"
fi

print_info "Master configuration updated: $MASTER_CONFIG ($MODEL_COUNT models)"

# Copy to current directory
cp "$MASTER_CONFIG" ./opencode.json
print_info "Copied opencode.json to current directory"
print_info "SAIA models are now available — restart OpenCode to load them."
