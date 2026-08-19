#!/usr/bin/env bash
set -euo pipefail

# SAIA Models Sync Script for opencode-saia-plugin
# Fetches latest models from SAIA API and updates opencode.json
# Run this periodically to keep the plugin in sync with SAIA

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PLUGIN_DIR/opencode.json"
TEMP_MODELS="$PLUGIN_DIR/.tmp-saia-models.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
print_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# API configuration
SAIA_API_KEY="${SAIA_API_KEY:-}"
API_BASE_URL="${SAIA_API_URL:-https://chat-ai.academiccloud.de/v1}"

# Check for API key
if [[ -z "$SAIA_API_KEY" ]]; then
    print_error "SAIA_API_KEY environment variable not set"
    print_info "Set it with: export SAIA_API_KEY=your_key"
    exit 1
fi

print_info "Fetching latest SAIA models from $API_BASE_URL..."

# Fetch models from API
MODELS_JSON=$(curl -s --max-time 30 "$API_BASE_URL/models" \
    -H "Authorization: Bearer $SAIA_API_KEY")

if [[ -z "$MODELS_JSON" ]] || ! echo "$MODELS_JSON" | jq -e '.data' >/dev/null 2>&1; then
    print_error "Failed to fetch models from SAIA API"
    print_info "Response: $MODELS_JSON"
    exit 1
fi

MODEL_COUNT=$(echo "$MODELS_JSON" | jq -r '.data | length')
print_info "Found $MODEL_COUNT models from SAIA API"

# Model metadata (curated knowledge)
# Format: id|reasoning|input_types|context|max_tokens|description|cost_per_1k|latency
declare -A MODEL_METADATA=(
    # Reasoning models
    ["qwen3.8-2.4t-a95b"]="true|text|256000|65536|Qwen 3.8 2.4T A95B (SAIA)|0.125|very-slow"
    ["qwen3.5-397b-a17b"]="true|text,image|131072|32768|Qwen 3.5 397B (SAIA)|0.125|very-slow"
    ["qwen3.5-122b-a10b"]="true|text,image|131072|32768|Qwen 3.5 122B (SAIA)|0.075|slow"
    ["qwen3-30b-a3b-instruct-2507"]="true|text|131072|16384|Qwen 3 30B (SAIA)|0.018|moderate"
    
    # Agentic models
    ["devstral-2-123b-instruct-2512"]="false|text|131072|16384|DevStral 2 123B (SAIA)|0.075|slow"
    ["mistral-medium-3.5-128b"]="false|text|131072|8192|Mistral Medium 3.5 128B (SAIA)|0.075|slow"
    ["qwen3.6-35b-a3b"]="false|text,image|131072|16384|Qwen 3.6 35B (SAIA)|0.018|moderate"
    
    # Coder
    ["qwen3-coder-next"]="false|text|131072|16384|Qwen 3 Coder Next (SAIA)|0.015|fast"
    
    # Large Context
    ["openai-gpt-oss-120b"]="false|text|131072|8192|GPT-OSS 120B (SAIA)|0.075|slow"
    
    # Medical
    ["medgemma-27b-it"]="false|text,image|32768|4096|MedGemma 27B (SAIA)|0.012|moderate"
    
    # Vision
    ["qwen3-omni-30b-a3b-instruct"]="false|text,image|32768|4096|Qwen 3 Omni 30B (SAIA)|0.018|moderate"
    
    # General
    ["qwen3.8-27b"]="false|text,image|131072|32768|Qwen 3.8 27B (SAIA)|0.006|moderate"
    ["deepseek-v4-flash-0731"]="false|text|131072|16384|DeepSeek V4 Flash (SAIA)|0.008|fast"
    ["qwen3.6-27b"]="false|text|131072|16384|Qwen 3.6 27B (SAIA)|0.006|moderate"
    ["gemma-4-31b-it"]="false|text,image|131072|8192|Gemma 4 31B (SAIA)|0.012|moderate"
    ["apertus-70b-instruct-2509"]="false|text|131072|8192|Apertus 70B (SAIA)|0.025|slow"
    ["meta-llama-3.1-8b-instruct"]="false|text|131072|4096|Meta Llama 3.1 8B (SAIA)|0.003|fast"
    ["glm-4.7"]="false|text|131072|16384|GLM 4.7 (SAIA)|0.015|fast"
)

# Models to add even if not in API response (newly released, not yet deployed)
declare -a FORCE_INCLUDE_MODELS=(
    "qwen3.8-2.4t-a95b"
    "qwen3.8-27b"
)

# Aliases
declare -A ALIASES=(
    ["best-for-coding"]="qwen3-coder-next"
    ["best-for-reasoning"]="qwen3.8-2.4t-a95b"
    ["best-quality"]="qwen3.8-2.4t-a95b"
    ["best-for-vision"]="qwen3.8-27b"
    ["best-for-agentic"]="glm-4.7"
    ["fastest"]="meta-llama-3.1-8b-instruct"
    ["fastest-reasoning"]="qwen3.8-27b"
    ["budget"]="deepseek-v4-flash-0731"
)

# Categorize model based on ID
categorize() {
    local id="$1"
    case "$id" in
        *thinking*|*r1*|qwen3.8-2.4t-a95b|qwen3.5-397b-a17b|qwen3.5-122b-a10b|qwen3-30b-a3b-instruct-2507)
            echo "reasoning"
            ;;
        *coder*)
            echo "coder"
            ;;
        *omni*|*vl-*|*vision*|internvl*)
            echo "vision"
            ;;
        medgemma*)
            echo "medical"
            ;;
        devstral*|mistral-medium*|glm-4.7)
            echo "agentic"
            ;;
        *120b|*128b|*235b|*675b)
            echo "large-context"
            ;;
        *)
            echo "general"
            ;;
    esac
}

# Get timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Build the new model list
print_info "Generating opencode.json..."

# Get list of API model IDs
API_MODEL_IDS=$(echo "$MODELS_JSON" | jq -r '.data[].id' | sort)

# Build final model list (API models + force-include)
FINAL_MODELS="$API_MODEL_IDS"
for model_id in "${FORCE_INCLUDE_MODELS[@]}"; do
    if ! echo "$FINAL_MODELS" | grep -qx "$model_id"; then
        FINAL_MODELS="$FINAL_MODELS"$'\n'"$model_id"
        print_info "  Adding (not in API): $model_id"
    fi
done

# Initialize empty models JSON
echo "{}" > "$TEMP_MODELS"

# Process all models
echo "$FINAL_MODELS" | while read -r model_id; do
    [[ -z "$model_id" ]] && continue
    
    if [[ -n "${MODEL_METADATA[$model_id]:-}" ]]; then
        IFS='|' read -r reasoning input_types context max_tokens description cost latency <<< "${MODEL_METADATA[$model_id]}"
        category=$(categorize "$model_id")
        
        # Format input types as JSON array
        input_json=$(echo "$input_types" | sed 's/,/", "/g' | sed 's/^/["/' | sed 's/$/"]/')
        
        # Build model config
        model_config=$(jq -n \
            --arg name "$description" \
            --argjson reasoning "$reasoning" \
            --argjson input "$input_json" \
            --argjson context "$context" \
            --argjson max_tokens "$max_tokens" \
            --argjson cost "$cost" \
            --arg latency "$latency" \
            --arg cat "$category" \
            '{
                name: $name,
                reasoning: $reasoning,
                input: $input,
                limit: { context: $context, output: $max_tokens },
                metadata: {
                    cost_per_1k_tokens: $cost,
                    estimated_latency: $latency,
                    category: $cat
                }
            }')
        
        # Add to temp file
        jq --arg id "$model_id" --argjson cfg "$model_config" '. + {($id): $cfg}' "$TEMP_MODELS" > "$TEMP_MODELS.tmp"
        mv "$TEMP_MODELS.tmp" "$TEMP_MODELS"
    fi
done

# Add aliases
for alias in "${!ALIASES[@]}"; do
    target="${ALIASES[$alias]}"
    
    # Check if target exists in final model list
    if echo "$FINAL_MODELS" | grep -qx "$target"; then
        IFS='|' read -r reasoning input_types context max_tokens description cost latency <<< "${MODEL_METADATA[$target]}"
        category=$(categorize "$target")
        
        input_json=$(echo "$input_types" | sed 's/,/", "/g' | sed 's/^/["/' | sed 's/$/"]/')
        
        alias_config=$(jq -n \
            --arg name "$alias → $target" \
            --argjson reasoning "$reasoning" \
            --argjson input "$input_json" \
            --argjson context "$context" \
            --argjson max_tokens "$max_tokens" \
            --argjson cost "$cost" \
            --arg latency "$latency" \
            --arg cat "$category" \
            --arg target "$target" \
            '{
                name: $name,
                reasoning: $reasoning,
                input: $input,
                limit: { context: $context, output: $max_tokens },
                metadata: {
                    cost_per_1k_tokens: $cost,
                    estimated_latency: $latency,
                    category: $cat,
                    alias_of: $target
                }
            }')
        
        jq --arg id "$alias" --argjson cfg "$alias_config" '. + {($id): $cfg}' "$TEMP_MODELS" > "$TEMP_MODELS.tmp"
        mv "$TEMP_MODELS.tmp" "$TEMP_MODELS"
    fi
done

# Read existing opencode.json structure
EXISTING_CONFIG=$(cat "$CONFIG_FILE")

# Update the config file with new models
echo "$EXISTING_CONFIG" | jq --slurpfile models "$TEMP_MODELS" '.provider.saia.models = $models[0]' > "$CONFIG_FILE.tmp"
mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"

# Clean up temp file
rm -f "$TEMP_MODELS"

print_info "✓ Successfully updated $CONFIG_FILE"
print_info "  Models synced: $MODEL_COUNT"
print_info "  Timestamp: $TIMESTAMP"

# Show summary
print_info "Model summary:"
echo "$FINAL_MODELS" | while read -r id; do
    if [[ -n "${MODEL_METADATA[$id]:-}" ]]; then
        echo "  ✓ $id"
    else
        echo "  ⚠ $id (no metadata)"
    fi
done
