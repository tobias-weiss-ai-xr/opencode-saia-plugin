#!/usr/bin/env bash
set -euo pipefail

# Plugin Auto-Update Script
# Checks for updates and supports rollback

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$HOME/.config/opencode/plugins/saia"
BACKUP_DIR="$HOME/.cache/saia/plugin-backups"
REMOTE_URL="https://codeberg.org/graphwiz-ai/opencode-saia-plugin"
CURRENT_VERSION="0.3.0"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

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
        cp -r "$PLUGIN_DIR" "$backup_path"
        print_success "Backup saved"
    fi
    print_info "Downloading latest from $REMOTE_URL"
    local tmpdir=$(mktemp -d)
    curl -sL "${REMOTE_URL}/archive/master.tar.gz" | tar xz -C "$tmpdir"
    mkdir -p "$PLUGIN_DIR"
    cp -r "$tmpdir"/*/src/* "$PLUGIN_DIR/" 2>/dev/null || true
    chmod +x "$PLUGIN_DIR"/*.sh 2>/dev/null || true
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
    rm -rf "$PLUGIN_DIR"
    cp -r "$BACKUP_DIR/$latest_backup" "$PLUGIN_DIR"
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
