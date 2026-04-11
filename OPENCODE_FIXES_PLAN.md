# OpenCode Limitations — Fix Plan

Generated: Sat Apr 11 2026
Repo: https://github.com/anomalyco/opencode (branch: dev)

## Priority Order

| # | Limitation | Difficulty | Dependencies |
|---|---|---|---|
| 1 | No Per-Model Timeout Configuration | Easy | None |
| 2 | No Config-Level Caching | Medium | None |
| 3 | No Per-Model Permission Control | Medium | None |
| 4 | No Fallback Model Mechanism | Hard | #3 (depends on model selection) |
| 5 | Strict Permission Matching (No Wildcards) | Hard | None |
| 6 | No Sandbox Mode | Hard | None |

---

## Fix 1: Per-Model Timeout Configuration

### Problem
Currently, bash commands use a single global timeout (`DEFAULT_TIMEOUT` from `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` flag, default 2 minutes). Different models have varying response times and capabilities—e.g., reasoning models like DeepSeek R1 or Qwen Thinking may need longer timeouts for chain-of-thought processing. There's no way to configure per-model timeout overrides.

### Files to Modify

- `packages/opencode/src/config/config.ts` (lines 795-909): Add `timeout` field to `Model` schema
- `packages/opencode/src/provider/provider.ts` (lines 1130-1204): Merge timeout from config to model definition
- `packages/opencode/src/tool/bash.ts` (lines 54-68, ~400): Use model.timeout instead of DEFAULT_TIMEOUT

### Implementation Steps

1. **Extend Config.Schema** (`config.ts`)
   - Add `timeout` field to `Model` schema (line 795):
     ```typescript
     export const Model = z.object({
       // ... existing fields ...
       timeout: z.number().int().positive().optional().describe("Override bash timeout in milliseconds for this model"),
     }).partial()
     ```

2. **Merge Timeout in Provider Layer** (`provider.ts`)
   - In `mergeProvider` or model parsing (around line 1189), ensure `timeout` is preserved from config:
     ```typescript
     timeout: model.timeout ?? provider.options?.timeout ?? undefined,
     ```

3. **Apply Timeout in Bash Tool** (`bash.ts`)
   - Modify bash tool's timeout logic (around line 400+):
     - Check if `model.timeout` is available
     - Fall back to `DEFAULT_TIMEOUT` if not set
   - Update `Parameters` schema to include optional `model` reference if needed
   - When executing command, use the resolved timeout value

4. **Testing Strategy**
   - Configure a model with `timeout: 10000` (10 seconds) in `opencode.json`
   - Run a long-running bash command with that model
   - Verify timeout is enforced after 10 seconds
   - Switch to a model without timeout override, verify DEFAULT_TIMEOUT applies

### Difficulty: Easy
No complex architecture changes—simple schema extension and conditional logic.

---

## Fix 2: Config-Level Caching

### Problem
OpenCode makes fresh API calls for every request, even for repeated identical prompts or context. While some providers support native caching (e.g., Anthropic's `cacheControl`), there's no application-level caching to reduce latency and API costs for repeated queries.

### Files to Modify

- `packages/opencode/src/session/llm.ts` (lines 84-350): Add cache layer before API call
- `packages/opencode/src/config/config.ts` (lines 912-1111): Add `cache` configuration schema
- `packages/opencode/src/provider/provider.ts`: Export cache interface

### Implementation Steps

1. **Define Cache Schema** (`config.ts`)
   - Add cache configuration to `Info` schema:
     ```typescript
     export const Cache = z.object({
       enabled: z.boolean().default(true).optional(),
       ttl: z.number().int().positive().default(3600000).optional().describe("Cache TTL in milliseconds (default 1 hour)"),
       maxSize: z.number().int().positive().default(1000).optional().describe("Max cached entries"),
     })
     export type Cache = z.infer<typeof Cache>

     // Add to Info schema (around line 970):
     cache: Cache.optional(),
     ```

2. **Implement In-Memory LRU Cache** (`session/llm.ts`)
   - Create cache module or inline implementation:
     ```typescript
     interface CacheEntry {
       result: string
       timestamp: number
     }
     const cache = new Map<string, CacheEntry>()
     ```
   - Add cache key generation (hash of model + messages):
     ```typescript
     function cacheKey(model: Provider.Model, messages: ModelMessage[]): string {
       return JSON.stringify({
         modelID: model.id,
         messages: messages.filter(m => m.role !== "system").slice(-5)
       })
     }
     ```
   - Wrap `streamText()` call with cache check:
     ```typescript
     const key = cacheKey(input.model, input.messages)
     const entry = cache.get(key)
     if (entry && Date.now() - entry.timestamp < cfg.cache.ttl) {
       // Return cached response
       return Stream.fromAsyncIterable(parseStream(entry.result))
     }
     ```

3. **Cache Invalidation**
   - Evict old entries based on LRU/TTL
   - Clear cache on model configuration change
   - Add cache stats logging

4. **Testing Strategy**
   - Enable cache in config
   - Send identical prompt twice, verify second is instant
   - Check cache stats in logs
   - Verify cache respects TTL (wait, repeat after expiration)
   - Test with different models (should have separate cache entries)

### Difficulty: Medium
Requires thread-safe cache implementation, proper cache key generation, and integration with streaming response handling.

---

## Fix 3: Per-Model Permission Control

### Problem
Permissions are configured globally or per-agent, but not per-model. Users may want to allow certain tools (e.g., `bash`, external file access) only for specific trusted models (like local models) while restricting them for cloud-hosted models. Currently, all agents using a given model share the same permissions, regardless of model characteristics.

### Files to Modify

- `packages/opencode/src/config/config.ts` (lines 795-909, 527-614): Add `permission` field to `Model` schema
- `packages/opencode/src/permission/index.ts` (lines 167-202): Modify permission evaluation to consider model-specific rules
- `packages/opencode/src/session/processor.ts` (lines 110-200): Pass model to permission evaluation

### Implementation Steps

1. **Extend Model Schema** (`config.ts`)
   - Add `permission` field to `Model` schema (line 795):
     ```typescript
     export const Model = z.object({
       // ... existing fields ...
       permission: Permission.optional().describe("Model-specific permission overrides"),
     }).partial()
     ```

2. **Update Agent Schema** (`config.ts`)
   - Clarify that agent permissions apply unless overridden by model (line 560)
   - Document priority: model > agent > global

3. **Modify Permission Evaluation** (`permission/index.ts`)
   - Update `ask` function to accept optional model parameter (line 167):
     ```typescript
     readonly ask: (input: {
       // ... existing fields ...
       model?: Provider.Model
     }) => Effect.Effect<void>
     ```
   - Merge model-specific rules with agent rules (line 169):
     ```typescript
     const modelRules = input.model?.permission
       ? Permission.fromConfig(input.model.permission)
       : []
     const mergedRules = Permission.merge(ruleset, modelRules, approved)
     ```

4. **Pass Model to Permission Calls** (`processor.ts`)
   - In session processor, pass model to permission.ask calls (around line 324):
     ```typescript
     yield* permission.ask({
       // ... existing fields ...
       model: ctx.model,
       ruleset: agent.permission,
     })
     ```

5. **Testing Strategy**
   - Configure model A with `bash: deny`, model B with `bash: allow`
   - Use agent X with both models
   - Try bash command with model A → should be denied
   - Try bash command with model B → should be allowed
   - Test that agent permissions still work when model has no override

### Difficulty: Medium
Requires extending the permission evaluation chain to handle model-level overrides while maintaining backward compatibility.

---

## Fix 4: Fallback Model Mechanism

### Problem
When a model encounters rate limits (429), overload (503), or service errors, OpenCode retries with exponential backoff but always uses the same model. There's no automatic fallback to an alternative model (e.g., from same provider or a "small_model") when the primary fails repeatedly.

### Files to Modify

- `packages/opencode/src/config/config.ts` (lines 912-1111): Add `fallbackModel` configuration
- `packages/opencode/src/session/retry.ts` (lines 104-122): Extend retry policy to handle model fallback
- `packages/opencode/src/session/processor.ts` (lines 553-603): Handle model switching in retry flow
- `packages/opencode/src/session/llm.ts`: Support dynamic model switching mid-stream

### Implementation Steps

1. **Define Fallback Configuration** (`config.ts`)
   - Add fallback configuration to `Info` schema:
     ```typescript
     export const FallbackModel = z.object({
       provider: z.string().optional(),
       model: z.string().describe("Fallback model ID (e.g., provider/model)"),
       maxAttempts: z.number().int().positive().default(3).optional(),
     })
     export type FallbackModel = z.infer<typeof FallbackModel>

     // Add to Info schema:
     fallbackModel: FallbackModel.optional(),
     ```

2. **Extend Retry Policy** (`retry.ts`)
   - Add model fallback detection to `retryable` function:
     ```typescript
     export function retryable(error: Err, attempts: number) {
       // ... existing logic ...
       if (attempts >= config.fallbackModel.maxAttempts) {
         return "fallback_triggered" // New trigger type
       }
       return error.data.message.includes("Rate Limited") ? "Rate Limited" : undefined
     }
     ```
   - Modify `delay` function to consider fallback triggers
   - Add fallback recommendation to retry metadata

3. **Handle Model Fallback in Processor** (`processor.ts`)
   - In `process` function, detect fallback condition (line 553):
     ```typescript
     const result = yield* llm.stream(streamInput).pipe(
       Effect.catchTaggedError("fallback_triggered", () => {
         // Fallback to alternative model
         const fallbackModel = yield* getFallbackModel(ctx.model)
         const newInput = { ...streamInput, model: fallbackModel }
         return llm.stream(newInput)
       })
     )
     ```

4. **Implement Model Resolution** (`processor.ts` or new helper)
   - Add function to resolve fallback model:
     ```typescript
     function getFallbackModel(currentModel: Provider.Model): Effect.Effect<Provider.Model> {
       const cfg = yield* config.get()
       const fallbackId = cfg.fallbackModel?.model
       const providerID = cfg.fallbackModel?.provider ?? currentModel.providerID
       return yield* provider.getModel(providerID, ModelID.make(fallbackId))
     }
     ```

5. **Handle State Migration**
   - Update assistant message metadata to indicate model switch
   - Add system notification when fallback occurs
   - Ensure compaction works with multi-model sessions

6. **Testing Strategy**
   - Configure fallback model in `opencode.json`
   - Trigger rate limit on primary model (or mock error)
   - Verify automatic switch to fallback model
   - Verify fallback respects maxAttempts limit
   - Test session continuity (context preserved across models)

### Difficulty: Hard
Requires handling state across model switches, preserving context, and ensuring tools/results work correctly with different models.

---

## Fix 5: Strict Permission Matching (No Wildcards)

### Problem
While `Wildcard.match()` supports basic `*` and `?` patterns, permission matching in OpenCode is limited. Users cannot use full glob patterns like `bash:*` (all bash subcommands), `read:**/*.ts` (all TypeScript files), or character classes `[a-z]`. The wildcard implementation is simplistic and doesn't support common glob features.

### Files to Modify

- `packages/opencode/src/util/wildcard.ts` (entire file): Replace with full glob implementation
- `packages/opencode/src/permission/index.ts` (lines 271-290): Update pattern documentation
- Add test suite for glob patterns

### Implementation Steps

1. **Choose Glob Implementation**
   - Option A: Use `fast-glob` or `minimatch` package (recommended)
   - Option B: Implement full glob support in-house (complex)

2. **Replace Wildcard Module** (`util/wildcard.ts`)
   - Install glob package:
     ```bash
     bun add minimatch
     ```
   - Rewrite `match` function:
     ```typescript
     import { minimatch } from "minimatch"

     export function match(str: string, pattern: string): boolean {
       return minimatch(str, pattern)
     }
     ```
   - Update `all` function to use glob's filter behavior
   - Update `allStructured` to use glob with path matching

3. **Update Permission Documentation** (`permission/index.ts`)
   - Document supported glob patterns in JSDoc
   - Add examples: `ls:*`, `read:**/src/**/*.ts`, `bash:[cp|mv|rm]`
   - Update `fromConfig` to handle pattern syntax validation

4. **Add Pattern Validation**
   - Validate glob patterns at config load time
   - Provide clear error messages for invalid patterns
   - Escape patterns where needed (e.g., `\\*` for literal asterisk)

5. **Testing Strategy**
   - Test exact match: `bash` matches `bash`
   - Test wildcard: `bash:*` matches `bash ls`, `bash rm`
   - Test double-wildcard: `read:**/*.ts` matches `src/foo.ts`
   - Test character class: `bash:[ls|cd|pwd]` matches those commands
   - Test negation (if supported): `!*` excludes matching patterns
   - Test escape: `\\*` matches literal asterisk in tool name

### Difficulty: Hard
Requires integrating external glob package and ensuring backward compatibility with existing permission configurations.

---

## Fix 6: Sandbox Mode

### Problem
The `bash` tool executes commands directly on the host system, which poses security risks for untrusted models or compromised API keys. There's no sandbox/containerization to isolate command execution. Models can run arbitrary shell commands with full system access.

### Files to Modify

- `packages/opencode/src/config/config.ts` (lines 795-909): Add `sandbox` configuration to `Model` schema
- `packages/opencode/src/tool/bash.ts` (entire file): Add Docker sandbox wrapper
- `packages/opencode/src/tool/docker.ts` (new file): Create Docker execution interface
- `packages/opencode/src/permission/index.ts`: Add `docker` or `sandbox` permission

### Implementation Steps

1. **Add Sandbox Configuration** (`config.ts`)
   - Add sandbox settings to `Model` schema:
     ```typescript
     export const Sandbox = z.object({
       enabled: z.boolean().optional().describe("Enable Docker sandbox for this model"),
       image: z.string().default("node:18").optional().describe("Docker image to use"),
       volumes: z.array(z.string()).optional().describe("Volume mounts (host:container)"),
       network: z.enum(["bridge", "host", "none"]).default("bridge").optional(),
     })
     export type Sandbox = z.infer<typeof Sandbox>

     // Add to Model schema:
     sandbox: Sandbox.optional(),
     ```

2. **Detect Docker Availability** (`tool/docker.ts` or `bash.ts`)
   - Check for Docker installation:
     ```typescript
     async function dockerAvailable(): Promise<boolean> {
       try {
         const result = await Bun.spawn(["docker", "--version"], {
           stdout: "pipe",
           stderr: "pipe",
         })
         return result.exitCode === 0
       } catch {
         return false
       }
     }
     ```

3. **Implement Docker Command Wrapper** (`tool/docker.ts`)
   - Create function to execute commands in container:
     ```typescript
     async function executeInDocker(
       command: string,
       sandbox: Sandbox,
       workdir: string
     ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
       const volume = `${workdir}:/workspace`
       const args = [
         "run", "--rm",
         "-w", "/workspace",
         "-v", volume,
         ...(sandbox.volumes || []).map(v => ["-v", v]),
         sandbox.image,
         "sh", "-c", command
       ]
       // Execute with Bun.spawn
     }
     ```

4. **Integrate into Bash Tool** (`tool/bash.ts`)
   - Check model.sandbox.enabled before execution
   - Route to Docker wrapper if enabled, direct execution otherwise
   - Handle Docker-specific errors (not installed, build failures)
   - Apply timeout to container execution

5. **Add Sandbox Permission** (`permission/index.ts`)
   - Add new permission type:
     ```typescript
     export const Permission = z.preprocess(
       permissionPreprocess,
       z.object({
         // ... existing fields ...
         docker: PermissionRule.optional(),
       })
     )
     ```
   - Require explicit permission for sandbox execution

6. **Handle Filesystem Access**
   - Configure Docker volumes for project directory access
   - Handle path translation (host path vs container path)
   - Preserve environment variables selectively (exclude secrets)

7. **Testing Strategy**
   - Enable sandbox for a model in config
   - Run simple command: `ls` → should work
   - Run file creation: `touch test.txt` → should appear in project dir
   - Test security: `rm -rf /` → should fail (container isolation)
   - Test without Docker → should fall back to direct execution or error
   - Test timeout: long command should be terminated

### Difficulty: Hard
Requires Docker integration, volume management, path translation, and comprehensive error handling. May not work on all platforms (e.g., WSL, macOS without Docker Desktop).

---

## Implementation Notes

### Order of Execution
1. Start with **Fix 1** (Timeouts) – simplest, provides immediate value
2. Implement **Fix 2** (Caching) – independent, quick win for performance
3. Tackle **Fix 3** (Per-Model Permissions) – leverages existing permission system
4. Address **Fix 5** (Wildcards) – improves permission flexibility
5. Work on **Fix 4** (Fallback Models) – most complex retry logic
6. Consider **Fix 6** (Sandbox Mode) – highest complexity, requires external dependencies

### Testing Strategy Summary
- Each fix should include unit tests for new logic
- Integration tests for cross-feature interactions (e.g., cache + fallback)
- E2E tests with representative user workflows
- Performance benchmarks for cache impact
- Security audits for sandbox isolation

### Backward Compatibility
- All new config fields should be optional
- Existing `opencode.json` files should continue to work
- Default behavior should match current implementation
- Migration path for old permission patterns to new glob syntax

### Dependencies
- For glob support: `minimatch` or `fast-glob` package
- For caching: may need lru-cache package
- For sandbox: Docker or similar container runtime

---

## Appendix: Code Locations Reference

| Feature | File Path | Key Lines/Sections |
|---|---|---|
| Config Schema | `packages/opencode/src/config/config.ts` | Lines 795-909 (Model), 912-1111 (Info) |
| Permission System | `packages/opencode/src/permission/index.ts` | Lines 279-291 (fromConfig), 167-202 (ask) |
| Wildcard Matching | `packages/opencode/src/util/wildcard.ts` | Entire file (59 lines) |
| Bash Execution | `packages/opencode/src/tool/bash.ts` | Lines 25-68 (Parameters), 306-519 (execution) |
| LLM Streaming | `packages/opencode/src/session/llm.ts` | Lines 29-52 (Interface), 84-350 (stream implementation) |
| Retry Policy | `packages/opencode/src/session/retry.ts` | Lines 104-122 (policy), 55-102 (retryable) |
| Session Processing | `packages/opencode/src/session/processor.ts` | Lines 110-200 (event handling), 553-603 (process) |
| Model Resolution | `packages/opencode/src/provider/provider.ts` | Lines 1052-1336 (layer, state initialization) |
