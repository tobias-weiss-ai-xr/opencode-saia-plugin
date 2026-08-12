#!/usr/bin/env bash
set -euo pipefail

# Plugin Auto-Update Script
# Checks for updates and supports rollback

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
PLUGIN_ROOT="$CONFIG_DIR/plugins"
PLUGIN_DIR="$PLUGIN_ROOT/saia"
BACKUP_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/saia/plugin-backups"
REMOTE_URL="${SAIA_PLUGIN_REMOTE_URL:-https://codeberg.org/graphwiz-ai/opencode-saia-plugin}"
CURRENT_VERSION="0.3.0"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# These immediate plugin files live alongside the nested runtime directory.
backup_entry_points() {
    local backup_path="$1"

    for entry_point in saia-plugin.ts saia-limits-tui.tsx; do
        if [[ -f "$PLUGIN_ROOT/$entry_point" ]]; then
            cp "$PLUGIN_ROOT/$entry_point" "$backup_path/$entry_point"
        fi
    done
}

restore_entry_points() {
    local backup_path="$1"

    for entry_point in saia-plugin.ts saia-limits-tui.tsx; do
        if [[ ! -f "$backup_path/$entry_point" ]]; then
            print_error "Backup is missing $entry_point"
            return 1
        fi
        cp "$backup_path/$entry_point" "$PLUGIN_ROOT/$entry_point"
    done
    node "$PLUGIN_DIR/install-tui-config.mjs" "$CONFIG_DIR"
}

check_version() {
    local latest
    latest=$(curl -s --max-time 10 "${REMOTE_URL}/raw/branch/master/package.json" | jq -r '.version' 2>/dev/null || echo "")
    if [[ -z "$latest" ]]; then
        print_error "Could not fetch latest version"
        return 1
    fi
    echo "$latest"
    if [[ "$latest" != "$CURRENT_VERSION" ]]; then
        print_info "Update available: $CURRENT_VERSION -> $latest"
        return 0
    else
        print_success "Already up to date ($CURRENT_VERSION)"
        return 0
    fi
}

do_update() {
    mkdir -p "$BACKUP_DIR"
    local backup_path="$BACKUP_DIR/pre-$(date +%Y%m%d-%H%M%S)"
    print_info "Backing up current plugin to $backup_path"
    if [[ -d "$PLUGIN_DIR" ]]; then
        mkdir -p "$backup_path"
        cp -r "$PLUGIN_DIR" "$backup_path/saia"
        backup_entry_points "$backup_path"
        print_success "Backup saved"
    fi
    print_info "Downloading latest from $REMOTE_URL"
    local tmpdir=$(mktemp -d)
    curl -fsSL "${REMOTE_URL}/archive/master.tar.gz" | tar xz -C "$tmpdir"
    local source_dir
    source_dir=""
    while IFS= read -r installer; do
        source_dir="$(dirname "$installer")"
        break
    done < <(find "$tmpdir" -mindepth 2 -maxdepth 2 -type f -name install-runtime.mjs -print)
    if [[ -z "$source_dir" ]]; then
        rm -rf "$tmpdir"
        print_error "Downloaded archive does not contain src/install-runtime.mjs"
        return 1
    fi
    if ! node "$source_dir/install-runtime.mjs" "$source_dir" "$CONFIG_DIR"; then
        rm -rf "$tmpdir"
        return 1
    fi
    rm -rf "$tmpdir"
    print_success "Plugin updated to latest version"
}

do_rollback() {
    if [[ ! -d "$BACKUP_DIR" ]]; then
        print_error "No backups found"
        exit 1
    fi
    local latest_backup=$(ls -t "$BACKUP_DIR" | head -1)
    if [[ -z "$latest_backup" ]]; then
        print_error "No backups found"
        exit 1
    fi
    print_info "Rolling back to: $latest_backup"
    if [[ ! -d "$BACKUP_DIR/$latest_backup/saia" ]]; then
        print_error "Backup is incomplete"
        exit 1
    fi
    rm -rf "$PLUGIN_DIR"
    cp -r "$BACKUP_DIR/$latest_backup/saia" "$PLUGIN_DIR"
    restore_entry_points "$BACKUP_DIR/$latest_backup"
    print_success "Rolled back to: $latest_backup"
}

case "${1:-}" in
    --check) check_version ;;
    --self-update) do_update ;;
    --rollback) do_rollback ;;
    --help|-h)
        echo "Usage: $0 [--check|--self-update|--rollback]"
        echo "  --check         Check for updates"
        echo "  --self-update   Update to latest version"
        echo "  --rollback      Restore previous version from backup"
        exit 0
        ;;
    *) check_version ;;
esac
