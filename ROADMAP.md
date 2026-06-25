# Roadmap: SAIA OpenCode Plugin - Future Improvements

This roadmap outlines potential enhancements for the SAIA plugin across short, medium, and long-term horizons. Items are prioritized by user impact and implementation effort.

---

## Short-Term (Ready to Implement)

### 1. Model Metadata Enhancements
- **Impact**: High
- **Effort**: Low
- **Description**: Add per-model metadata in `generate-saia-config.sh`
  - Add `cost_per_1k_tokens` fields (pricing estimate)
  - Add `estimated_latency_ms` (latency categorization)
  - Add `recommended_for` tags (e.g., "agentic-coding", "chat", "vision")
- **Benefit**: Better model selection guidance
- **Files**: `src/generate-saia-config.sh`, `src/opencode-saia.json`

### 2. Config Validation
- **Impact**: Medium
- **Effort**: Low
- **Description**: Validate `opencode.json` against schema before use
  - Add schema file (JSON Schema draft-07)
  - Add validation script that runs on install/update
  - Provide clear error messages for invalid configs
- **Benefit**: Early error detection, better UX
- **Files**: `src/validate-config.sh` (new), `schema/opencode.schema.json` (new)

### 3. Multiple Profile Support
- **Impact**: High
- **Effort**: Low-Medium
- **Description**: Allow multiple SAIA model sets (e.g., cheap vs expensive)
  - Support `LITELLM_PROXY_PROFILE` environment variable
  - Generate `opencode-production.json`, `opencode-dev.json`
  - Use symlinks or copy-on-demand for profile switching
- **Benefit**: Cost optimization, environment separation
- **Files**: `src/generate-saia-config.sh`, `README.md`, `install.sh`

### 4. Enhanced Error Logging
- **Impact**: Medium
- **Effort**: Low
- **Description**: Improve error messages and logging
  - Log elapsed time for API fetch
  - Cache last successful fetch timestamp
  - Add "Last updated: DATE" header in generated config
  - Provide "why this error happened" hints in logs
- **Benefit**: Better debugging and user support
- **Files**: `src/generate-saia-config.sh`, `src/saia.ts`

### 5. Model Group Aliases
- **Impact**: Medium
- **Effort**: Low
- **Description**: Add aliases for model groups
  - `best-for-coding` → glastParameters/Internal/Versions/ExpertsOfTheDay
  - `best-for-vision` → Top vision model
  - `budget-friendly` → Cheapest per-token model
  - Use via `/model @budget-friendly` in OpenCode
- **Benefit**: Easier model discovery
- **Files**: `generate-saia-config.sh`, `opencode-saia.json`, `README.md`

---

## Medium-Term (Feature Additions)

### 6. Model Health Monitoring
- **Impact**: High
- **Effort**: Medium
- **Description**: Track model uptime and performance
  - Add health check endpoint or `--health` mode
  - Measure response latency and error rates
  - Track model availability flags (e.g., "degraded", "unavailable")
  - Generate health report: `saia-health.txt` or JSON
- **Benefit**: Proactive model selection, avoid outages
- **Files**: `src/health-check.sh` (new), `src/generate-saia-config.sh`

### 7. Fallback Model Configuration
- **Impact**: High
- **Effort**: Medium
- **Description**: Auto-switch to backup model on errors
  - Add `fallback_model` field to generated config
  - Implement retry with fallback logic (OpenCode-level)
  - Support per-provider fallbacks
  - Add `primary_retry_attempts` config option
- **Benefit**: Improved reliability, graceful degradation
- **Files**: `src/opencode-saia.json`, `README.md`

### 8. Model Usage Analytics
- **Impact**: Medium
- **Effort**: Medium
- **Description**: Optionally track model usage patterns
  - Opt-in `SAIA_TELEMETRY_ENABLED` flag
  - Log model choices without data exfiltration
  - Generate usage report: top models, avg prompts per user (local-only)
  - Export to CSV or JSON for analysis
- **Benefit**: Data-driven model optimization
- **Files**: `src/analytics.sh` (new), `src/saia.ts`, `README.md`

### 9. Config Precedence System
- **Impact**: Medium
- **Effort**: Medium
- **Description**: Implement proper config override hierarchy
  - Priority: local project config > global config > defaults
  - Add `--local-only` mode for projects that must use local overrides
  - Support hierarchical model overrides (provider → model)
- **Benefit**: Flexible configuration across projects
- **Files**: `src/generate-saia-config.sh`, `src/saia.ts`, `README.md`

### 10. Multi-Provider Support
- **Impact**: High
- **Effort**: Medium-High
- **Description**: Add support for additional AI providers
  - Add LiteLLM-native provider (if API compatible)
  - Support local LLM providers (llama.cpp, ollama)
  - Add provider health checks and latency measurement
  - Allow fallback to other providers within same service class
- **Benefit**: Reduced vendor lock-in, optionality
- **Files**: `src/generate-saia-config.sh`, `src/provider/*.sh`, `README.md`

---

## Long-Term (Architectural Improvements)

### 11. Plugin-Based Model Registry
- **Impact**: High
- **Effort**: High
- **Description**: Migrate to OpenCode plugin architecture for model registry
  - Implement `saia.ts` as native plugin (no external scripts)
  - Replace shell scripts with Node.js or Rust for performance
  - Add real-time model discovery from SAIA API
  - Implement in-memory caching of model metadata
  - Make it a first-class OpenCode plugin (installable via npm/bun)
- **Benefit**: Better OpenCode integration, cross-platform, no shell dependencies
- **Files**: `src/saia-plugin.ts` (rewrite), `package.json`, `build/` directory

### 12. Distributed Config Sync
- **Impact**: Medium
- **Effort**: High
- **Description**: Sync config across multiple machines
  - Add remote config store (GitLab/GitLab repo or S3)
  - Implement `pull` and `push` commands for config sync
  - Support encrypted config sync (optional)
  - Conflict resolution for concurrent updates
- **Benefit**: Consistent config across dev environments, teams
- **Files**: `src/sync-config.sh` (new), `README.md`

### 13. Model A/B Testing Framework
- **Impact**: Medium
- **Effort**: High
- **Description**: Support A/B testing of models/features
  - Add `experimental` flag for models in config
  - Implement traffic splitting (e.g., `shaia_ab_test: 0.1`)
  - Generate A/B test reports (latency, cost, quality)
  - Support gradual rollout and rollback
- **Benefit**: Data-driven model selection, safer experimentation
- **Files**: `src/ab-test-config.sh` (new), `src/opencode-saia.json`, `README.md`

### 14. Plugin Auto-Update
- **Impact**: Medium
- **Effort**: High
- **Description**: Ability to update the plugin itself
  - Add `--self-update` mode to fetch latest version
  - Compare installed vs latest version via API/Git tags
  - Backup current config before update
  - Support rollback to previous version
- **Benefit**: Easier maintenance, security patches
- **Files**: `src/update-plugin.sh` (new), `README.md`

### 15. Real-Time Model Discovery
- **Impact**: High
- **Effort**: Very High
- **Description**: Live model discovery from SAIA API (periodic refresh)
  - Add background process for periodic model refresh
  - Use OpenCode plugin event system for notifications
  - Cache model metadata with TTL
  - Notify on new models, deprecated models
  - Auto-apply model categorization rules
- **Benefit**: Always up-to-date, no manual updates needed
- **Files**: `src/saia-live.ts`, `src/model-discovery.ts`, `package.json`

---

## Maintenance & Cleanup Tasks

### 16. Documentation Polish
- **Impact**: Low
- **Effort**: Low
- **Description**: Improve docs completeness
  - Add architecture diagram
  - Add troubleshooting flowchart
  - Add FAQ section
  - Add model comparison table (cost, speed, quality)
  - Translate docs to German (SAIA users)
- **Files**: `README.md`, `ARCHITECTURE.md` (new), `FAQ.md` (new)

### 17. Security Audits
- **Impact**: High
- **Effort**: Medium
- **Description**: Security review and hardening
  - Audit API key handling (no logging, no process env leaks)
  - Add validation for script paths (prevent injection)
  - Review jq/sed regex patterns for ReDoS risks
  - Add checksum validation for downloads
  - Document security model and threat model
- **Benefit**: Build trust, prevent vulnerabilities
- `Files: README.md, SECURITY.md (new), src/*.sh, src/saia.ts`

### 18. Performance Optimization
- **Impact**: Medium
- **Effort**: Medium
- **Description**: Optimize plugin startup time
  - Benchmark shell script execution time
  - Add incremental update mode (only changed models)
  - Cache SAIA API responses locally (JSON in `~/.cache/saia/`)
  - Parallelize independent fetches (if API supports)
- **Benefit**: Faster OpenCode startup, lower latency
- `Files: src/generate-saia-config.sh, src/saia.ts, README.md`

### 19. Interactive Setup Wizard
- **Impact**: Low
- **Effort**: Medium
- **Description**: Add guided setup for first-time users
  - Ask for API interactively (optional)
  - Validate SAIA_API_KEY before proceeding
  - Auto-detect install location (Linux/Mac/Windows WSL)
  - Run one-time validation test
- **Benefit**: Better onboarding, reduces setup errors
- `Files: install-wizard.sh (new), README.md`

### 20. Packaging and Distribution
- **Impact**: Medium
- **Effort**: Medium
- **Description**: Improve installation and distribution
  - Publish npm package (optional)
  - Create Homebrew formula
  - Create Docker image for self-hosted OpenCode instances
  - Add release automation (GitHub/GitLab Actions)
  - Provide checksums and signatures for releases
- **Benefit**: Easier installation, trust verification
- `Files: package.json, Formula/, Dockerfile, .github/workflows/, install.sh`

---

## Recommended Implementation Order

1. **Phase 1** (Immediate): Items 1-5 (metadata, validation, error logging, Gids, short-Term) 
2. **Phase 2** (Next): Items 6-10 (health monitoring, fallback, usage analytics, config precedence, multi-provider)
3. **Phase 3** (Long-term): Items 11-15 (plugin architecture, distributed sync, A/B testing, self-update, real-time discovery)
4. **Phase 4** (Maintenance): Items 16-20 (documentation, security, performance, setup wizard, packaging)

---

## Additional Considerations

- **Dependencies**: Keep external deps minimal (currently: `curl`, `jq`, `node`/`bun` for plugin)
- **Testing**: Add integration tests for critical paths (config generation, model discovery, health checks)
- **Backward Compatibility**: Ensure new features don't break existing setups
- **OpenCode Integration**: Stay compatible with official OpenCode plugin API
- **Community**: Engage with SAIA and OpenCode communities for model updates and best practices

---

This roadmap is a living document. Items can be added, removed, or reprioritized based on user feedback, OpenCode API changes, and SAIA service updates.
