# SAIA Model Refresh

Forces regeneration of the SAIA model list by bypassing the 24h cache.

## Usage

Trigger this skill when:
- You need the latest model list immediately
- New models have been added to SAIA
- cache shows stale/obsolete model data

## What this does

1. Calls `clearCache()` to remove `~/.cache/saia/models.json`
2. Forces the plugin to fetch fresh data from the SAIA API
3. Caches the new model list with fresh 24h TTL

## Notes

- Does NOT affect project context or user preferences
- Does NOT clear usage metrics
- After refresh, the plugin will automatically update your OpenCode config with the latest models
