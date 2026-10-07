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
| `saia-facts-collector.test.mjs` | Collector parsing/matching/merge logic (US-C1–C5) |
| `saia-facts-invariants.test.mjs` | Committed facts + reasoning-map contract (US-F1–F3) |
| `saia-config-drift.test.mjs` | Generated config vs. collected facts (US-D1–D5) |
| `saia-wire-contract.test.mjs` | Wire-level surface contract (US-W1–W5) |

---

## Epic SAIA-CONFIG — Provider registration & config decoration

> As an OpenCode user I want the SAIA plugin to wrap the live model list into a
> valid provider config (apiKey, transport, overlays, default model) on
> startup, so that `/model saia/<id>` works and my own overrides survive.

### US1 — Decorates an empty config with only ready models
- **Then** only `status: "ready"` models are kept, the default model is
  `saia/glm-5.3-flash`, `apiKey` is injected, `managedModels` are recorded, and
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

---

## Epic SAIA-FACTS — Auto-collected model facts are correct and complete

> As a repo consumer I want `scripts/collect-saia-model-info.mjs` to turn the
> live API, the GWDG docs table and the curated reasoning map into a clean,
> unopinionated catalog — with every ambiguity reported as a gap instead of
> guessed — so `data/saia-models.json` is trustworthy enough to curl and build
> on.

### US-C1 — Docs context displays parse to exact token counts
- **Given** docs cells like "65k", "256K", "1M", "1.05M"
- **When** `parseContextWindow` runs
- **Then** they become 65000/256000/1000000/1050000 (decimal k/M), and garbage
  stays `null` — never a guess.
- **Test:** `saia-facts-collector.test.mjs` → "context window display values
  parse to exact token counts".

### US-C2 — Recommended sampling parses to vendor params
- **Given** "temp=0.8, top_p=0.9" style cells
- **Then** `parseRecommended` yields `{temperature, top_p}` and returns
  `undefined` for dashes/prose.
- **Test:** `saia-facts-collector.test.mjs` → "recommended sampling parses…".

### US-C3 — Docs names match API ids (Instruct drift; external excluded)
- **Given** "Gemma 4 31B Instruct" vs `gemma-4-31b-it`
- **Then** `matchDocsRow` strips the trailing "Instruct" and matches, and
  closed/external models are never matched.
- **Test:** `saia-facts-collector.test.mjs` → "docs names match API ids…".

### US-C4 — Reasoning entries resolve by longest prefix
- **Given** overlapping prefixes (`qwen3-` false, `qwen3.5-` true)
- **Then** `reasoningFor` picks the longest match; unknown ids report
  `{supported: null}` for gap tracking.
- **Test:** `saia-facts-collector.test.mjs` → "reasoning entries resolve by
  longest prefix…".

### US-C5 — The merge reports every gap honestly
- **Given** a live model with no docs row, a docs row with no API model, and a
  closed + an embeddings row
- **Then** `buildCatalog` fills `api_without_docs`, `docs_without_api` (external
  and embeddings excluded) and `reasoning_unknown`, and leaves missing facts
  null rather than guessing.
- **Test:** `saia-facts-collector.test.mjs` → "buildCatalog merges all three
  sources and reports every gap honestly".

### US-F1 — The committed facts file satisfies its contract
- **Given** `data/saia-models.json`
- **Then** ids are unique, every model accepts text, has a parsed context
  window and a decided reasoning flag, and `gaps` is empty.
- **Test:** `saia-facts-invariants.test.mjs` → "data/saia-models.json satisfies
  the catalog contract".

### US-F2 — The curated reasoning map covers every live model
- **Given** `scripts/reasoning-models.json`
- **Then** prefixes are unique, every live model resolves via longest prefix
  exactly as recorded in the data file, and every supported entry cites vendor
  sources.
- **Test:** `saia-facts-invariants.test.mjs` → "the curated reasoning map covers
  every live model exactly".

### US-F3 — Supported models name their vendor API surface
- **Given** any model with `reasoning.supported === true`
- **Then** it carries a `toggle` or `effort` param so clients know what to send.
- **Test:** `saia-facts-invariants.test.mjs` → "supported models name their
  vendor API surface".

---

## Epic SAIA-DRIFT — The generated config never drifts from the facts

> As an OpenCode user I want `opencode.json` to mirror `data/saia-models.json`
> (contexts, reasoning, sampling, aliases) so the model picker shows reality —
> the flat-131072 era must be structurally impossible to reintroduce.

### US-D1 — Every live model configured with its docs-verified context
- **Test:** `saia-config-drift.test.mjs` → "every live model is configured with
  its docs-verified context window" (also rejects a flat 131072 regression).

### US-D2 — Aliases point only at live models
- **Test:** `saia-config-drift.test.mjs` → "every alias resolves to a live model
  and inherits its limits".

### US-D3 — Retired models stay gone
- **Test:** `saia-config-drift.test.mjs` → "retired models stay gone after sync"
  (glm-4.7, qwen3.8-2.4t-a95b, qwen3.5-122b-a10b, qwen3.6-27b, medgemma-27b-it).

### US-D4 — The default model ships with its own config
- **Test:** `saia-config-drift.test.mjs` → "the default model is installed by
  this very config".

### US-D5 — Reasoning flags and sampling mirror the facts
- **Test:** `saia-config-drift.test.mjs` → "reasoning flags and recommended
  sampling mirror the facts file".

---

## Epic SAIA-HYGIENE — retired models and hand-curated tables stay dead

> As a user I want no shipped surface (config, scripts, docs) to recommend a
> model that 500s because SAIA retired it, and no metadata to sneak back in
> as literals.

### US-H1 — No shipped surface mentions a retired model
- **Given** the retired set (glm-4.7, qwen3.8-2.4t-a95b, qwen3.5-122b-a10b,
  qwen3.6-27b, medgemma-27b-it)
- **Then** none of opencode.json, src/opencode-saia.json,
  generate-saia-config.sh, README.md contain one. (CHANGELOG is history and
  exempt.)
- **Test:** `saia-hygiene.test.mjs` → "no shipped surface mentions a retired
  model".

### US-H2 — Sync script carries taste, not facts-as-literals
- **Then** the sync script contains no hardcoded context windows, no
  FORCE_INCLUDE/MODEL_METADATA tables, and reads facts via `fact_for`.
- **Test:** `saia-hygiene.test.mjs` → "sync script carries taste, not
  facts-as-literals".

### US-H3 — Shell entry points parse
- **Then** `bash -n` passes on the sync + generate scripts.
- **Test:** `saia-hygiene.test.mjs` → "shell entry points parse".

---

## Epic SAIA-WIRE — what OpenCode sends to SAIA is what SAIA serves

> As a user I want aliases to resolve and models to advertise what they really
> do, so a shortcut never hides a 404 and vision/reasoning claims are real.

### US-W1 — Every alias declares the upstream model id it calls
- **Test:** `saia-wire-contract.test.mjs` → "every alias declares the upstream
  model id" (each alias entry carries `id: <target>`, and inherits the target's
  limits, so OpenCode never asks SAIA for `best-for-coding`).

### US-W2 — One alias map is shared everywhere
- **Test:** `saia-wire-contract.test.mjs` → "the plugin, the generated config
  and the sync script share one alias map" (`src/saia-aliases.mjs` is read by
  the runtime plugin, `scripts/sync-saia-models.sh` and
  `src/generate-saia-config.sh`).

### US-W3 — No surface emits a field OpenCode ignores
- **Test:** `saia-wire-contract.test.mjs` → "no surface emits a field OpenCode
  ignores" (`input`, `can_reason` are gone; `attachment`/`reasoning` are
  boolean and explicit).

### US-W4 — The README table mirrors the shipped config
- **Test:** `saia-wire-contract.test.mjs` → "the README table mirrors the
  shipped config" (context in decimal K, output limits in binary K).

### US-W5 — Shipped code names no retired model
- **Test:** `saia-wire-contract.test.mjs` → "shipped code names no retired
  model" (a fresh install can never be recommended a 404).

## Epic SAIA-DOCS — the documentation can never lag the catalog

> As a user I want README claims enforced by CI, so docs never recommend
> dead models or stale limits again.

### US-O1 — README model table matches the live catalog exactly
- **Test:** `saia-docs.test.mjs` → "README model table matches the live
  catalog exactly" (id set + context windows vs. data/saia-models.json).

### US-O2 — Documented default model is the shipped default
- **Test:** `saia-docs.test.mjs` → "documented default model is the shipped
  default" (`saia/deepseek-v4-flash-0731`).

### US-O3 — The raw-catalog curl URL is correct
- **Test:** `saia-docs.test.mjs` → "the raw-catalog curl URL is correct"
  (https; codeberg 302s plain http silently).

---

## Epic SAIA-CONTRACT — the data file's own structure is consistent

> As a repo consumer I want the data file internally verifiable, so the
> catalog cannot claim models the API never returned.

### US-T1 — models[] derives from the recorded live snapshot
- **Test:** `saia-contract.test.mjs` → "models[] is derived from the recorded
  live snapshot" (same ids, same input/output modalities).

### US-T2 — Provenance fields are present and well-formed
- **Test:** `saia-contract.test.mjs` → "provenance fields are present and
  well-formed" (parseable generated_at, https source URLs).
