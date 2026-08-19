# pi-saia-plugin Scripts

## sync-saia-models.sh

Auto-sync script that fetches the latest model list from the SAIA API and regenerates `extensions/index.ts`.

### Usage

```bash
# Set your SAIA API key
export SAIA_API_KEY=your_api_key_here

# Run the sync
./scripts/sync-saia-models.sh
```

Or with environment variable:

```bash
SAIA_API_KEY=your_key ./scripts/sync-saia-models.sh
```

### What it does

1. Fetches models from `https://chat-ai.academiccloud.de/v1/models`
2. Filters models with known metadata (curated list of 18 models)
3. Adds Qwen3.8 models even if not yet deployed to SAIA
4. Generates categorized model entries in `extensions/index.ts`
5. Creates 8 model aliases for common use cases

### Force-include models

Some models (like Qwen3.8) may not be deployed to SAIA yet but are added automatically:
- `qwen3.8-2.4t-a95b` - Flagship reasoning model
- `qwen3.8-27b` - Vision-capable general model

These are added from the `FORCE_INCLUDE_MODELS` array in the script.

### Automation

Add to crontab for daily sync:

```bash
# Sync SAIA models daily at 2 AM
0 2 * * * cd /path/to/pi-saia-plugin && SAIA_API_KEY=xxx ./scripts/sync-saia-models.sh && git add extensions/index.ts && git commit -m "chore: sync SAIA models" && git push
```

### Output

The script generates a TypeScript file with:
- All models from SAIA API (with metadata)
- Models not yet in API but in metadata (force-included)
- 8 convenience aliases (best-for-coding, best-quality, etc.)

### Dependencies

- `jq` - JSON processing
- `curl` - API requests
- `bash` 4.0+ - Associative arrays
