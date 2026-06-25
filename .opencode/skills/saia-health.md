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

## Notes

- Only checks read endpoints (does not test completions)
- Requires valid `SAIA_API_KEY` environment variable
- Results are logged to OpenCode app logs
