// Files owned by the installed SAIA runtime. Keep this list explicit so all
// installation paths ship the same loadable module set and never copy tests.
export const SAIA_RUNTIME_FILES = Object.freeze([
  "install-runtime.mjs",
  "install-tui-config.mjs",
  "runtime-manifest.mjs",
  "saia-api-key.mjs",
  "saia-config.mjs",
  "saia-endpoint.mjs",
  "saia-limits-server.js",
  "saia-memory.ts",
  "saia-model-metadata.js",
  "saia-settings.mjs",
  "saia-system-messages.js",
  "saia-transport.mjs",
  "saia.ts",
  "set-saia-transport.mjs",
  "update-plugin.sh",
  "provider/ollama.sh",
])

// OpenCode discovers these immediate files under plugins/. They import the
// implementation from the nested saia/ directory above.
export const SAIA_PLUGIN_ROOT_FILES = Object.freeze([
  "saia-plugin.ts",
  "saia-limits-tui.tsx",
])
