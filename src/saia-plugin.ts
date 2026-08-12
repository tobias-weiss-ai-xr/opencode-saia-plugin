// Installed as ~/.config/opencode/plugins/saia-plugin.ts.
//
// OpenCode discovers immediate files in the plugins directory, which is why the
// installer places this small wrapper there. No "plugin" entry in opencode.json is
// needed for that layout. Explicit plugin configuration can also use a relative local
// path when a project needs to opt into a plugin deliberately.
//
// The implementation stays nested in saia/ so its helper modules are not themselves
// picked up as plugins. Behaviour confirmed on OpenCode 1.18.16.
import plugin from "./saia/saia.js"

export default plugin

// Files installed under ~/.config do not inherit this package's "type": "module".
// Preserve the ESM default while also making tsx/CommonJS loaders expose the function
// directly, as OpenCode plugin entrypoints expect.
if (typeof module !== "undefined") {
  module.exports = plugin
}
