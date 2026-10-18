#!/usr/bin/env bash
# Usage: reconcile-opencode-models.sh [--dry-run] [config-file]
# Reconciles every provider's model list directly against its live /v1/models
# endpoint and prunes stale keys from the config.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
print_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
print_warn()  { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }

# Use bun (preferred) or node w/ tsx
RUNNER_SUBST="bun"
if ! command -v bun &>/dev/null; then
  RUNNER_SUBST="node --import tsx --input-type=module"
fi

# Run the Node module
exec $RUNNER_SUBST "$SCRIPT_DIR/reconcile-opencode-models.mjs" "$@"
