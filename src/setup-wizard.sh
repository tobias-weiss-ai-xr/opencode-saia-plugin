#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NON_INTERACTIVE=false

usage() {
  echo "Usage: bash src/setup-wizard.sh [--non-interactive]"
}

case "${1:-}" in
  "")
    ;;
  --non-interactive)
    NON_INTERACTIVE=true
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 1
    ;;
esac

print_header() { printf '\n%s\n' "$1"; }
print_success() { printf '  OK %s\n' "$1"; }
print_error() { printf '  ERROR %s\n' "$1" >&2; }
print_info() { printf '  %s\n' "$1"; }

confirm() {
  local response
  printf '  %s (y/n) ' "$1"
  read -r response
  [[ "$response" =~ ^[Yy]$ ]]
}

detect_shell() {
  if [[ -n "${ZSH_VERSION:-}" ]]; then
    echo "zsh"
  elif [[ -n "${BASH_VERSION:-}" ]]; then
    echo "bash"
  else
    echo "unknown"
  fi
}

validate_api_key() {
  local key="$1"
  local result
  result=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" \
    "https://chat-ai.academiccloud.de/v1/models" \
    -H "Authorization: Bearer $key")
  [[ "$result" == "200" ]]
}

has_api_key_command() {
  SAIA_SOURCE_DIR="$SCRIPT_DIR" SAIA_CONFIG_DIR="$1" node --input-type=module - <<'NODE'
import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const sourceDir = process.env.SAIA_SOURCE_DIR
const configDir = process.env.SAIA_CONFIG_DIR
const { isSaiaApiKeyCommand } = await import(
  pathToFileURL(path.join(sourceDir, "saia-api-key.mjs")).href
)

try {
  const settings = JSON.parse(await readFile(path.join(configDir, "saia.json"), "utf8"))
  process.exit(isSaiaApiKeyCommand(settings?.apiKeyCommand) ? 0 : 1)
} catch {
  process.exit(1)
}
NODE
}

write_to_shell_rc() {
  local shell_rc="$1"
  local key="$2"
  local export_line="export SAIA_API_KEY=\"$key\""

  if grep -q "SAIA_API_KEY" "$shell_rc" 2>/dev/null; then
    sed -i.bak "s|export SAIA_API_KEY=.*|$export_line|" "$shell_rc"
    print_success "Updated SAIA_API_KEY in $shell_rc"
  else
    {
      printf '\n# SAIA API key for OpenCode plugin\n'
      printf '%s\n' "$export_line"
    } >> "$shell_rc"
    print_success "Added SAIA_API_KEY to $shell_rc"
  fi
}

ensure_opencode_config() {
  local config_dir="$1"
  local config_file="$config_dir/opencode.json"

  mkdir -p "$config_dir"
  if [[ ! -f "$config_file" ]]; then
    cat > "$config_file" <<'EOF'
{
  "$schema": "https://opencode.ai/config.json"
}
EOF
    print_success "Created $config_file"
  fi
}

run_wizard() {
  local config_dir="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
  local plugin_dir="$config_dir/plugins/saia"
  local shell
  local api_key="${SAIA_API_KEY:-}"
  local auth_source=""

  if [[ -t 1 ]]; then clear; fi
  print_header "SAIA Plugin for OpenCode Setup"
  print_info "Configuration directory: $config_dir"

  if has_api_key_command "$config_dir"; then
    auth_source="apiKeyCommand"
    print_success "Using apiKeyCommand from $config_dir/saia.json"
  elif [[ -n "$api_key" ]]; then
    auth_source="environment"
    if [[ "$NON_INTERACTIVE" == false ]]; then
      if validate_api_key "$api_key"; then
        print_success "SAIA_API_KEY is valid"
      else
        print_error "SAIA_API_KEY could not be validated"
        if ! confirm "Continue anyway?"; then
          exit 1
        fi
      fi
    fi
  elif [[ "$NON_INTERACTIVE" == true ]]; then
    print_error "No SAIA_API_KEY or valid apiKeyCommand is configured"
    exit 1
  else
    print_info "Get an API key from https://chat-ai.academiccloud.de"
    printf '  Enter your SAIA API key: '
    read -r api_key
    if [[ -z "$api_key" ]]; then
      print_error "No API key provided"
      exit 1
    fi
    auth_source="entered"

    if validate_api_key "$api_key"; then
      print_success "API key validated"
    else
      print_error "API key could not be validated"
      if ! confirm "Continue anyway?"; then
        exit 1
      fi
    fi
  fi

  node "$SCRIPT_DIR/install-runtime.mjs" "$SCRIPT_DIR" "$config_dir"
  if [[ ! -f "$config_dir/saia.json" ]]; then
    node "$plugin_dir/set-saia-transport.mjs" chat-completions "$config_dir"
  fi
  ensure_opencode_config "$config_dir"
  print_success "Installed plugin files to $plugin_dir"

  if [[ "$auth_source" == "entered" && "$NON_INTERACTIVE" == false ]]; then
    shell="$(detect_shell)"
    case "$shell" in
      bash)
        if confirm "Persist SAIA_API_KEY in ~/.bashrc?"; then
          write_to_shell_rc "$HOME/.bashrc" "$api_key"
        fi
        ;;
      zsh)
        if confirm "Persist SAIA_API_KEY in ~/.zshrc?"; then
          write_to_shell_rc "$HOME/.zshrc" "$api_key"
        fi
        ;;
      *)
        print_info "Export SAIA_API_KEY in your shell before starting OpenCode."
        ;;
    esac
  fi

  print_header "Setup complete"
  if [[ "$auth_source" == "apiKeyCommand" ]]; then
    print_info "OpenCode will resolve the key from apiKeyCommand without writing it to disk."
  fi
  print_info "Start OpenCode in any project and select /model saia/<model-id>."
}

run_wizard
