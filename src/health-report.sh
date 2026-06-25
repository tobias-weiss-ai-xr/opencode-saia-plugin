#!/usr/bin/env bash
set -euo pipefail

# SAIA Model Health Report
# Reads ~/.cache/saia/metrics.json and generates a health report with
# success rates, average latency, and availability status per model.

METRICS_FILE="${HOME}/.cache/saia/metrics.json"
REPORT_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() { echo -e "${BLUE}$1${NC}"; }
print_success() { echo -e "${GREEN}  ✓ $1${NC}"; }
print_error() { echo -e "${RED}  ✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}  → $1${NC}"; }

classify_status() {
    local success_rate="$1"
    if awk "BEGIN {exit !($success_rate >= 0.90)}"; then
        echo "healthy"
    elif awk "BEGIN {exit !($success_rate >= 0.70)}"; then
        echo "degraded"
    else
        echo "unavailable"
    fi
}

color_status() {
    local status="$1"
    case "$status" in
        healthy)     echo -e "${GREEN}healthy${NC}" ;;
        degraded)    echo -e "${YELLOW}degraded${NC}" ;;
        unavailable) echo -e "${RED}unavailable${NC}" ;;
        *)           echo "$status" ;;
    esac
}

if [[ ! -f "$METRICS_FILE" ]]; then
    print_error "Metrics file not found: $METRICS_FILE"
    print_info "No model usage data recorded yet. Use SAIA models to generate metrics."
    exit 1
fi

if ! jq -e '.' "$METRICS_FILE" >/dev/null 2>&1; then
    print_error "Metrics file is not valid JSON: $METRICS_FILE"
    exit 1
fi

MODEL_COUNT=$(jq -r 'del(.["$report_timestamp"]) | keys | length' "$METRICS_FILE")
if [[ "$MODEL_COUNT" -eq 0 ]]; then
    print_info "No models found in metrics file."
    exit 0
fi

print_header "╔══════════════════════════════════════════════════════╗"
print_header "║            SAIA Model Health Report                ║"
print_header "╚══════════════════════════════════════════════════════╝"
echo ""
print_info "Report generated: $REPORT_TIMESTAMP"
print_info "Models tracked:   $MODEL_COUNT"
echo ""

MODELS=$(jq -r 'del(.["$report_timestamp"]) | keys | .[]' "$METRICS_FILE" | sort)

printf "%-40s %-14s %-14s %s\n" "Model" "Success Rate" "Avg Latency" "Status"
printf "%-40s %-14s %-14s %s\n" "$(printf '%.0s-' {1..40})" "$(printf '%.0s-' {1..14})" "$(printf '%.0s-' {1..14})" "$(printf '%.0s-' {1..12})"

while IFS= read -r model; do
    [[ -z "$model" ]] && continue

    count=$(jq -r ".[\"$model\"].count // 0" "$METRICS_FILE")
    success=$(jq -r ".[\"$model\"].success // 0" "$METRICS_FILE")
    total_latency=$(jq -r ".[\"$model\"].totalLatency // 0" "$METRICS_FILE")

    if [[ "$count" -gt 0 ]]; then
        success_rate=$(awk "BEGIN {printf \"%.1f\", ($success / $count) * 100}")
        if [[ "$total_latency" -gt 0 ]] && [[ "$success" -gt 0 ]]; then
            avg_latency=$(awk "BEGIN {printf \"%.0f\", $total_latency / $success}")
            avg_latency_display="${avg_latency}ms"
        else
            avg_latency_display="N/A"
        fi
    else
        success_rate="0.0"
        avg_latency_display="N/A"
    fi

    if [[ "$count" -gt 0 ]]; then
        ratio=$(awk "BEGIN {printf \"%.3f\", $success / $count}")
    else
        ratio="0"
    fi
    status=$(classify_status "$ratio")
    status_colored=$(color_status "$status")

    if [[ ${#model} -gt 38 ]]; then
        display_model="${model:0:35}..."
    else
        display_model="$model"
    fi

    printf "%-40s %-14s %-14s %b\n" "$display_model" "${success_rate}%" "$avg_latency_display" "$status_colored"
done <<< "$MODELS"

echo ""

TOTAL=$(jq '[.[] | .count] | add // 0' "$METRICS_FILE")
TOTAL_SUCCESS=$(jq '[.[] | .success] | add // 0' "$METRICS_FILE")
TOTAL_ERRORS=$(jq '[.[] | .errors] | add // 0' "$METRICS_FILE")

print_info "Total requests: $TOTAL"
print_success "Successful:    $TOTAL_SUCCESS"
if [[ "$TOTAL_ERRORS" -gt 0 ]]; then
    print_error "Failed:        $TOTAL_ERRORS"
else
    print_info "Failed:        $TOTAL_ERRORS"
fi

jq --arg ts "$REPORT_TIMESTAMP" '.["$report_timestamp"] = $ts' "$METRICS_FILE" > "${METRICS_FILE}.tmp" && mv "${METRICS_FILE}.tmp" "$METRICS_FILE"
echo ""
print_success "Report timestamp written to metrics file."
