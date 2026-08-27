# Testing — opencode-saia-plugin

This document describes the **epics** and **user stories** that must be tested
for the SAIA provider plugin for [OpenCode](https://opencode.ai), and maps each
story to a concrete test under `src/*.test.mjs`.

## How to run

```bash
npm install                 # installs tsx + @opencode-ai/plugin + @opentui
npm test                    # node --import tsx --test src/*.test.mjs
npm run validate            # bash src/validate-config.sh opencode.json  (actual tool)
```

> **Note (regression):** the suite previously could not even load because of two
> syntax bugs in `src/saia-memory.ts` that are now fixed:
> 1. Line ~73: a template literal `` `fetch:${cacheFile}" `` was closed with a
>    double-quote instead of a backtick, leaving the template unterminated.
> 2. `checkForNewModels()` was missing its closing `}` before `getCacheStats()`.
> Additionally, `src/saia.test.mjs` asserted a stale warning string
> (`Models were not refreshed`); it now matches the actual error
> (`SAIA models response must be an object containing a data array`).

## Test inventory

| Test file | Focus |
|-----------|-------|
| `saia-config.test.mjs` | Model-response validation + cache-miss on invalid cache |
| `saia.test.mjs` | `createSaiaPlugin` config hook: decoration, apiKey, settings, overlays, malformed data |
| `saia-plugin-entrypoint.test.mjs` | Source server wrapper + TUI quota display + slot registration |
| `saia-api-key.test.mjs` | API-key resolution (env, command, validation, caching) |
| `saia-transport.test.mjs` | Transport resolution (env, settings, defaults, invalid) |
| `saia-system-messages.test.mjs` | Qwen system-message normalization |
| `saia-model-metadata.test.mjs` | `buildSaiaModel` / `buildSaiaModels` from API data |
| `saia-limits-server.test.mjs` | Rate-limit header capture + session save wiring |
| `install-runtime.test.mjs` | `install-runtime.mjs` lifecycle script |
| `install-tui-config.test.mjs` | `install-tui-config.mjs` TUI layout |
| `set-saia-transport.test.mjs` | `set-saia-transport.mjs` switching script |

---

## Epic SAIA-CONFIG — Provider registration & config decoration

> As an OpenCode user I want the SAIA plugin to wrap the live model list into a
> valid provider config (apiKey, transport, overlays, default model) on
> startup, so that `/model saia/<id>` works and my own overrides survive.

### US1 — Decorates an empty config with only ready models
- **Then** only `status: "ready"` models are kept, the default model is
  `saia/glm-4.7`, `apiKey` is injected, `managedModels` are recorded, and
  metrics (`api`/`refresh`) are updated.
- **Test:** `saia.test.mjs` → "decorates an empty config in memory with only
  ready SAIA models".

### US2 — Preserves direct and proxy overlays, non-SAIA defaults
- **Then** a user/proxy `baseURL`, `apiKey`, `headers`, per-model `limit` and
  `options` overlays, custom aliases, and an unrelated `openai` default are
  preserved; `managedModels` and other settings survive.
- **Test:** `saia.test.mjs` → "preserves direct and proxy provider overlays
  plus a non-SAIA default".

### US3 — Reports malformed data once and leaves other providers intact
- **Then** a malformed `/v1/models` payload is reported exactly once, the
  unrelated provider is unchanged, and `api`/`refresh` metrics are false.
- **Test:** `saia.test.mjs` → "reports malformed model data once and leaves
  unrelated providers available".

---

## Epic SAIA-AUTH — API key & transport resolution

> As a user I want flexible, secure API-key sources and transport selection so
> the plugin works in CI, with a password manager, or behind a proxy.

### US4 — API key resolution order
- **Then** an exported `SAIA_API_KEY` wins over `apiKeyCommand`; argv commands
  run without a shell, string commands run via a platform shell, output is
  trimmed, invalid commands are rejected, and the command runs once per
  process.
- **Test:** `saia-api-key.test.mjs` (9 cases).

### US5 — Transport selection
- **Then** `SAIA_API_TRANSPORT` / settings select `chat-completions`
  (default) or `responses`, invalid values are ignored with a warning, and the
  chosen npm package is applied.
- **Test:** `saia-transport.test.mjs`, `saia.test.mjs` ("preserves a transport
  choice…", "rejects unsupported transport choices").

---

## Epic SAIA-MODELS — Catalog, metadata & system messages

> As a user I want SAIA models auto-discovered from the API with correct
> tooling/reasoning flags and Qwen-specific system-message handling.

### US6 — Response validation & caching
- **Then** only non-empty ready-model lists are accepted as a cached response,
  non-ready/invalid entries are filtered with warnings, and a structurally
  invalid cache is treated as a miss.
- **Test:** `saia-config.test.mjs`.

### US7 — Metadata derivation
- **Then** `buildSaiaModel` derives `options`, `attachment` (image/audio/
  video inputs) and `reasoning` (`thought` output) flags; `buildSaiaModels`
  sorts and objectifies the list.
- **Test:** `saia-model-metadata.test.mjs`.

### US8 — Qwen system-message normalization
- **Then** strict Qwen deployments collapse multiple system fragments into one
  non-empty message; other providers are untouched.
- **Test:** `saia-system-messages.test.mjs`.

---

## Epic SAIA-QUOTA — Rate-limit / quota tracking

> As a user I want live quota remaining surfaced in the TUI without leaking
> routing state off the client.

### US9 — Quota capture & TUI display
- **Then** the limits hook wraps `fetch` for the provider origin, reads
  `x-ratelimit-*` (incl. LiteLLM `llm_provider-` prefixes), formats labels
  (`26/m · 128/h · 530/d · 2.5k/mo`), strips the internal session header, and
  registers the `session_prompt_right` slot.
- **Test:** `saia-limits-server.test.mjs`, `saia-plugin-entrypoint.test.mjs`
  ("formats quota labels and registers the TUI prompt slot").

---

## Epic SAIA-LIFECYCLE — Install & tooling

> As an operator I want the install/transport tooling to be correct so upgrades
> and switching never corrupt the plugin layout.

### US10 — Install & transport tooling
- **Then** the runtime/TUI install scripts and the `set-saia-transport`
  switcher produce a valid, loadable plugin layout.
- **Test:** `install-runtime.test.mjs`, `install-tui-config.test.mjs`,
  `set-saia-transport.test.mjs`, `saia-plugin-entrypoint.test.mjs` ("loads the
  source server wrapper and initializes its hooks").

### US11 — Config schema validation (actual tool)
- **Then** `bash src/validate-config.sh opencode.json` validates the generated
  config against the schema and fails on missing/invalid fields.
- **Tool:** `src/validate-config.sh` (run via `npm run validate`).
