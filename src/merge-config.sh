#!/usr/bin/env bash
set -euo pipefail

# Config Precedence Merge System
# Local project config > Global config > Defaults
# Deep-merges models with precedence

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_CONFIG="$SCRIPT_DIR/opencode-saia.json"
GLOBAL_CONFIG="$HOME/.config/opencode/opencode.json"
LOCAL_CONFIG="./opencode.json"
OUTPUT_FILE="$LOCAL_CONFIG"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

merge_configs() {
    local local_file="$LOCAL_CONFIG"
    local global_file="$GLOBAL_CONFIG"
    local defaults_file="$DEFAULT_CONFIG"
    local output="$OUTPUT_FILE"

    # Start with defaults
    if [[ ! -f "$defaults_file" ]]; then
        print_error "Defaults not found: $defaults_file"
        exit 1
    fi
    jq '.' "$defaults_file" > /tmp/merged.json

    # Overlay global config on defaults
    if [[ -f "$global_file" ]]; then
        jq -s '.[0] * .[1]' /tmp/merged.json "$global_file" > /tmp/merged2.json
        mv /tmp/merged2.json /tmp/merged.json
        print_info "Merged global config: $global_file"
    fi

    # Overlay local config on top
    if [[ -f "$local_file" ]]; then
        jq -s '.[0] * .[1]' /tmp/merged.json "$local_file" > /tmp/merged2.json
        mv /tmp/merged2.json /tmp/merged.json
        print_info "Merged local config: $local_file"
    fi

    # Write output
    jq '.' /tmp/merged.json > "$output"
    print_success "Merged config written to: $output"
}

usage() {
    echo "Usage: $0 [options]"
    echo "  --local-only    Skip global/defaults merge (use only local)"
    echo "  --output FILE   Write merged config to FILE (default: ./opencode.json)"
    echo "  --help          Show this help"
    exit 0
}

LOCAL_ONLY=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --local-only) LOCAL_ONLY=true; shift ;;
        --output) OUTPUT_FILE="$2"; shift 2 ;;
        --help|-h) usage ;;
        *) shift ;;
    esac
done

if [[ "$LOCAL_ONLY" == "true" ]]; then
    print_info "Local-only mode: using only local config"
    if [[ -f "$LOCAL_CONFIG" ]]; then
        cp "$LOCAL_CONFIG" "$OUTPUT_FILE"
        print_success "Config written to: $OUTPUT_FILE"
    else
        print_error "Local config not found: $LOCAL_CONFIG"
        exit 1
    fi
else
    merge_configs
fi
