#!/usr/bin/env node
// Entry point for npm global CLI: npx opencode-saia-plugin --dry-run
// Loads .env if present, then delegates to the core implementation
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { main } from "./src/reconcile-opencode-models.mjs"

async function loadEnv() {
  const envPaths = [
    resolve(".env"),
    resolve(process.cwd(), ".env"),
    resolve(process.argv[1], "..", ".env"),
  ]
  for (const p of envPaths) {
    try {
      const text = await readFile(p, "utf8")
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
        if (m) process.env[m[1]] = m[2]
      }
    } catch {
      // file not found – continue
    }
  }
}

// Pass process.argv so main can slice(2) itself
loadEnv().then(() => main(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => { console.error(`[SAIA] ${err.message}`); process.exit(1) }))
