#!/usr/bin/env bash
set -euo pipefail

# Ollama Provider Integration
# Fetches models from a local Ollama instance

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
API_URL="${OLLAMA_BASE_URL}/api/tags"

fetch_ollama_models() {
    print_info "Fetching Ollama models from $OLLAMA_BASE_URL"
    local result
    result=$(curl -s --max-time 10 "$API_URL" 2>/dev/null || echo "")

    if [[ -z "$result" ]]; then
        print_error "Cannot reach Ollama at $OLLAMA_BASE_URL"
        print_info "Ensure Ollama is running: ollama serve"
        return 1
    fi

    local count
    count=$(echo "$result" | jq -r '.models | length' 2>/dev/null || echo "0")
    print_info "Found $count Ollama models"
    echo "$result" | jq -r '.models[].name' | sed 's/:latest$//'
}

generate_ollama_provider_config() {
    local models_json
    models_json=$(fetch_ollama_models) || return 1

    local first=true
    echo '"ollama": {'
    echo '  "npm": "@ai-sdk/openai-compatible",'
    echo '  "name": "Ollama (Local)",'
    echo '  "options": {'
    echo "    \"baseURL\": \"${OLLAMA_BASE_URL}/v1\","
    echo '    "apiKey": ""'
    echo '  },'
    echo '  "models": {'

    while IFS= read -r model; do
        [[ -z "$model" ]] && continue
        if [[ "$first" == "true" ]]; then
            first=false
        else
            echo ","
        fi
        printf '    "%s": {"name": "Ollama %s", "options": {"enable-tools": true}}' "$model" "$model"
    done <<< "$models_json"
    echo ""
    echo '  }'
    echo '}'
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    generate_ollama_provider_config
fi
