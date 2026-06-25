#!/usr/bin/env bash
set -euo pipefail

# SAIA Model Usage Analytics
# Reads ~/.cache/saia/usage.jsonl and outputs usage statistics:
# top 5 models by count, average latency per model, tasks by type breakdown.

USAGE_FILE="${HOME}/.cache/saia/usage.jsonl"
CSV_MODE=false

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() { echo -e "${BLUE}$1${NC}"; }
print_success() { echo -e "${GREEN}  ✓ $1${NC}"; }
print_error() { echo -e "${RED}  ✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}  → $1${NC}"; }

usage() {
    echo "Usage: $0 [--csv]"
    echo ""
    echo "Options:"
    echo "  --csv    Export report as CSV to stdout"
    echo "  -h, --help  Display this help message"
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --csv) CSV_MODE=true; shift ;;
        -h|--help) usage ;;
        *) print_error "Unknown option: $1"; usage ;;
    esac
done

# Telemetry check
SAIA_TELEMETRY_ENABLED="${SAIA_TELEMETRY_ENABLED:-local-only}"
if [[ "$SAIA_TELEMETRY_ENABLED" == "none" ]]; then
    print_info "Telemetry disabled (SAIA_TELEMETRY_ENABLED=none). No analytics available."
    exit 0
fi

if [[ ! -f "$USAGE_FILE" ]]; then
    print_error "Usage file not found: $USAGE_FILE"
    print_info "No usage data recorded yet. Use SAIA models to generate usage entries."
    exit 1
fi

LINE_COUNT=$(wc -l < "$USAGE_FILE" | tr -d ' ')

if [[ "$LINE_COUNT" -eq 0 ]]; then
    print_info "Usage file is empty."
    exit 0
fi

# Validate at least one JSON line
if ! head -1 "$USAGE_FILE" | jq -e '.' >/dev/null 2>&1; then
    print_error "Usage file is not valid JSONL: $USAGE_FILE"
    exit 1
fi

if [[ "$CSV_MODE" == "true" ]]; then
    # CSV export: full dump with header
    echo "timestamp,projectRoot,modelId,taskType,latencyMs"
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        ts=$(echo "$line" | jq -r '.timestamp // ""')
        pr=$(echo "$line" | jq -r '.projectRoot // ""')
        mi=$(echo "$line" | jq -r '.modelId // ""')
        tt=$(echo "$line" | jq -r '.taskType // ""')
        lm=$(echo "$line" | jq -r '.latencyMs // ""')
        echo "${ts},${pr},${mi},${tt},${lm}"
    done < "$USAGE_FILE"
    exit 0
fi

print_header "╔══════════════════════════════════════════════════════╗"
print_header "║          SAIA Model Usage Analytics                ║"
print_header "╚══════════════════════════════════════════════════════╝"
echo ""
print_info "Telemetry mode: $SAIA_TELEMETRY_ENABLED"
print_info "Usage entries:   $LINE_COUNT"
echo ""

# Top 5 models by usage count
print_header "Top 5 Models by Usage Count"
echo ""
printf "%-40s %-10s %-14s\n" "Model" "Count" "Avg Latency"
printf "%-40s %-10s %-14s\n" "$(printf '%.0s-' {1..40})" "$(printf '%.0s-' {1..10})" "$(printf '%.0s-' {1..14})"

jq -r -s '
    group_by(.modelId)
    | map({modelId: .[0].modelId, count: length, avgLatency: (map(.latencyMs // 0) | add) / (map(select(.latencyMs != null)) | length)})
    | sort_by(-.count)
    | .[0:5]
    | .[] | [.modelId, (.count | tostring), (if .avgLatency > 0 then (.avgLatency | floor | tostring + "ms") else "N/A" end)]
    | @tsv
' "$USAGE_FILE" 2>/dev/null | while IFS=$'\t' read -r model count latency; do
    [[ -z "$model" ]] && continue
    if [[ ${#model} -gt 38 ]]; then
        display_model="${model:0:35}..."
    else
        display_model="$model"
    fi
    printf "%-40s %-10s %-14s\n" "$display_model" "$count" "$latency"
done

echo ""

# Average latency per model (all models)
print_header "Average Latency per Model"
echo ""
printf "%-40s %s\n" "Model" "Avg Latency"
printf "%-40s %s\n" "$(printf '%.0s-' {1..40})" "$(printf '%.0s-' {1..12})"

jq -r -s '
    group_by(.modelId)
    | map({modelId: .[0].modelId, entries: ., count: length})
    | map({modelId: .modelId, avgLatency: (
        if (.entries | map(select(.latencyMs != null)) | length) > 0 then
            (.entries | map(.latencyMs // 0) | add) / (.entries | map(select(.latencyMs != null)) | length)
        else null end
    )})
    | sort_by(-(.avgLatency // 0))
    | .[] | [.modelId, (if .avgLatency != null then (.avgLatency | floor | tostring + "ms") else "N/A" end)]
    | @tsv
' "$USAGE_FILE" 2>/dev/null | while IFS=$'\t' read -r model latency; do
    [[ -z "$model" ]] && continue
    if [[ ${#model} -gt 38 ]]; then
        display_model="${model:0:35}..."
    else
        display_model="$model"
    fi
    printf "%-40s %s\n" "$display_model" "$latency"
done

echo ""

# Tasks by type breakdown
print_header "Tasks by Type"
echo ""
printf "%-25s %s\n" "Task Type" "Count"
printf "%-25s %s\n" "$(printf '%.0s-' {1..25})" "$(printf '%.0s-' {1..6})"

jq -r -s '
    group_by(.taskType)
    | map({taskType: .[0].taskType, count: length})
    | sort_by(-.count)
    | .[] | [.taskType, (.count | tostring)]
    | @tsv
' "$USAGE_FILE" 2>/dev/null | while IFS=$'\t' read -r task_type count; do
    [[ -z "$task_type" ]] && continue
    printf "%-25s %s\n" "$task_type" "$count"
done

echo ""

TOTAL=$(jq -s 'length' "$USAGE_FILE" 2>/dev/null || echo "0")
WITH_LATENCY=$(jq -s '[.[] | select(.latencyMs != null)] | length' "$USAGE_FILE" 2>/dev/null || echo "0")
AVG_LATENCY=$(jq -s '[.[] | select(.latencyMs != null) | .latencyMs] | if length > 0 then add / length else 0 end | floor' "$USAGE_FILE" 2>/dev/null || echo "0")

print_info "Total entries:     $TOTAL"
print_info "With latency:      $WITH_LATENCY"
print_info "Overall avg latency: ${AVG_LATENCY}ms"
echo ""
print_info "Export with: $0 --csv > usage-report.csv"
