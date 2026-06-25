# SAIA Health Check

Performs health checks on the SAIA API service and reports latency, availability, and model count.

## Usage

Trigger this skill when:
- You suspect SAIA API issues
- Model requests are timing out or failing
- You want to verify API connectivity

## What this checks

1. **API connectivity**: Tests if `https://chat-ai.academiccloud.de/v1/models` responds
2. **Latency**: Measures round-trip time to fetch model list
3. **Availability**: Reports how many models are currently available
4. **Cache status**: Shows whether cached data is fresh or stale

## Output format

```
SAIA Health Report (2026-06-25T12:00:00Z)

✓ API connectivity: OK
  Latency: 847ms
  Models available: 27
  Cache: Fresh (last updated 2h ago)
```

## Fallback Model Configuration

The SAIA plugin supports a `fallback_model` setting in `opencode-saia.json`. When the primary model
fails or is unavailable, OpenCode automatically falls back to the configured fallback model.

- **Default fallback**: `saia/llama-3.1-8b-instruct` (the most reliable small model)
- **Location**: Top-level field in `opencode-saia.json`: `"fallback_model": "saia/llama-3.1-8b-instruct"`
- **Behavior**: OpenCode attempts the primary model first; if it encounters errors (timeout, rate limit,
  server error), it retries with the fallback model
- **Recommendation**: Keep the fallback model set to a small, fast model like `llama-3.1-8b-instruct`
  for maximum reliability

## Model Health Monitoring

The SAIA plugin tracks per-model health metrics in `~/.cache/saia/metrics.json`. Generate a health
report with:

```bash
bash src/health-report.sh
```

The report displays a table with:
- **Model**: Model identifier
- **Success Rate**: Percentage of successful requests
- **Avg Latency**: Average response time in milliseconds
- **Status**: `healthy` (>=90%), `degraded` (>=70%), or `unavailable` (<70%)

Each report run also writes a `$report_timestamp` to the metrics file for tracking report history.

## Model Usage Analytics

The SAIA plugin logs each model request to `~/.cache/saia/usage.jsonl` in JSONL format. Generate
usage analytics with:

```bash
bash src/analytics-report.sh        # Plain text report
bash src/analytics-report.sh --csv > usage-report.csv   # CSV export
```

The report includes:
- **Top 5 models by usage count**
- **Average latency per model**
- **Tasks by type breakdown** (coding, general, documentation, etc.)

### Telemetry Control

Set the `SAIA_TELEMETRY_ENABLED` environment variable to control analytics collection:

| Value       | Behavior                                         |
|-------------|--------------------------------------------------|
| `local-only` (default) | Analytics stored locally only, no network transmission |
| `none`      | Disables all analytics collection                |

## Notes

- Only checks read endpoints (does not test completions)
- Requires valid `SAIA_API_KEY` environment variable
- Results are logged to OpenCode app logs
