#!/usr/bin/env node
// Collects SAIA model facts and writes data/saia-models.json — a clean,
// unopinionated, machine-readable model catalog anyone can curl and reuse:
//
//   1. Live model list   GET {SAIA_API_URL:-https://chat-ai.academiccloud.de}/v1/models
//                        → ids, status, input/output modalities (authoritative for existence)
//   2. GWDG docs table   https://docs.hpc.gwdg.de/.../models/index.html
//                        → context window, release date, advantages/limitations,
//                          recommended sampling parameters, organization
//   3. scripts/reasoning-models.json (committed, curated)
//                        → reasoning API params per model family. This is the
//                          ONLY manual layer; any live model without a matching
//                          entry is reported as a gap so it gets curated.
//
// Usage:
//   node scripts/collect-saia-model-info.mjs [--out FILE] [--offline] [--strict]
//     --offline  skip the live API call, reuse the api facts recorded in the
//                previous run (docs are re-fetched)
//     --strict   exit 1 when any live model lacks docs facts or reasoning info
//
// No dependencies — Node.js >= 18.

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import process from "node:process"

const API_BASE = process.env.SAIA_API_URL?.replace(/\/+$/, "") ?? "https://chat-ai.academiccloud.de/v1"
const DOCS_URL = "https://docs.hpc.gwdg.de/services/ai-services/chat-ai/models/index.html"

const args = process.argv.slice(2)
const outIndex = args.indexOf("--out")
const outPath = resolve(args[outIndex + 1] ?? "data/saia-models.json")
const offline = args.includes("--offline")
const strict = args.includes("--strict")

function warn(message) {
  console.warn(`[WARN] ${message}`)
}

async function fetchLiveModels() {
  if (offline) return undefined
  const apiKey = process.env.SAIA_API_KEY
  if (!apiKey) {
    warn("SAIA_API_KEY not set — falling back to the previous run's live facts (--offline)")
    return undefined
  }
  const response = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`live API returned ${response.status}`)
  const body = await response.json()
  if (!Array.isArray(body?.data)) throw new Error("live API response has no .data array")
  return body.data
}

async function fetchDocs() {
  const response = await fetch(DOCS_URL, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`docs returned ${response.status}`)
  return response.text()
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", ndash: "–", mdash: "—" }

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(parseInt(entity.slice(2), 16))
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10))
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

function cellText(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    // drop flag emoji and other non-BMP symbols used in the org column
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

// "65k" → 65000, "1M" → 1000000, "1.05M" → 1050000, "4096" → 4096.
// Deliberately decimal: the docs table is the source of truth and writes
// "256K"/"1M"; the raw display string is preserved next to the number.
function parseContextWindow(display) {
  const match = /^([\d.]+)\s*([kKmM])?$/.exec(display.replace(/,/g, ""))
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  const scale = { k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[match[2]] ?? 1
  return Math.round(value * scale)
}

// "temp=0.8, top_p=0.9" → {temperature: 0.8, top_p: 0.9}
function parseRecommended(text) {
  const recommended = {}
  for (const [, key, value] of text.matchAll(/(temp(?:erature)?|top_p)\s*=\s*([\d.]+)/gi)) {
    const normalized = key.toLowerCase().startsWith("temp") ? "temperature" : "top_p"
    recommended[normalized] = Number(value)
  }
  return Object.keys(recommended).length ? recommended : undefined
}

function parseDocsTables(html) {
  const rows = []
  for (const table of html.matchAll(/<table>[\s\S]*?<\/table>/g)) {
    for (const row of table[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) => cellText(cell[1]))
      if (cells.length < 8) continue
      if (/^organization$/i.test(cells[0])) continue // header
      const [org, name, open, released, contextDisplay, advantages, limitations, recommended] = cells
      rows.push({
        org: org || undefined,
        name,
        external: /^no$/i.test(open),
        released: released || undefined,
        context_window: { display: contextDisplay, tokens: parseContextWindow(contextDisplay) },
        advantages: advantages && advantages !== "-" ? advantages : undefined,
        limitations: limitations && limitations !== "-" ? limitations : undefined,
        recommended: parseRecommended(recommended),
        embeddings: /embedding/i.test(advantages) || /embedding/i.test(name),
      })
    }
  }
  return rows
}

const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "")

// Docs display names sometimes carry an "Instruct" suffix the API id lacks
// ("Gemma 4 31B Instruct" vs "gemma-4-31b-it").
function nameAliases(name) {
  const norm = normalize(name)
  const stripped = norm.replace(/instruct$/, "")
  return stripped && stripped !== norm && stripped.length >= 6 ? [norm, stripped] : [norm]
}

function matchDocsRow(id, docsRows) {
  const target = normalize(id)
  const candidates = docsRows.filter((row) => !row.external)
  const exact = candidates.find((row) => nameAliases(row.name).includes(target))
  if (exact) return exact
  return candidates.find((row) =>
    nameAliases(row.name).some(
      (alias) => alias.includes(target) || target.includes(alias),
    ),
  )
}

async function loadReasoningEntries(scriptDir) {
  const raw = JSON.parse(await readFile(resolve(scriptDir, "reasoning-models.json"), "utf8"))
  // Longest prefix wins so "qwen3.5-" is not shadowed by a shorter pattern.
  return [...raw.entries].sort((a, b) => b.prefix.length - a.prefix.length)
}

function reasoningFor(id, entries) {
  const entry = entries.find((entry) => id === entry.prefix || id.startsWith(entry.prefix))
  if (!entry) return { supported: null }
  const reasoning = { supported: entry.supported }
  for (const key of ["toggle", "effort", "note", "sources"]) {
    if (entry[key] !== undefined) reasoning[key] = entry[key]
  }
  return reasoning
}

async function main() {
  const scriptDir = new URL(".", import.meta.url).pathname
  const gaps = { api_without_docs: [], docs_without_api: [], reasoning_unknown: [] }

  let liveModels
  let previous
  try {
    previous = JSON.parse(await readFile(outPath, "utf8"))
  } catch {
    previous = undefined
  }

  liveModels = await fetchLiveModels()
  if (!liveModels) {
    liveModels = previous?.live?.models
    if (!liveModels) throw new Error("no live model facts available (set SAIA_API_KEY or run online first)")
  }

  let docsRows
  try {
    docsRows = parseDocsTables(await fetchDocs())
  } catch (error) {
    docsRows = []
    warn(`could not fetch/parse GWDG docs (${error.message}) — context windows will be missing`)
  }

  const reasoningEntries = await loadReasoningEntries(scriptDir)

  const models = []
  const usedDocsRows = new Set()
  for (const model of [...liveModels].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const docs = matchDocsRow(model.id, docsRows)
    if (!docs) gaps.api_without_docs.push(model.id)
    else usedDocsRows.add(docs)

    const reasoning = reasoningFor(model.id, reasoningEntries)
    if (reasoning.supported === null) gaps.reasoning_unknown.push(model.id)

    models.push({
      id: model.id,
      name: docs?.name ?? model.name ?? model.id,
      org: docs?.org,
      status: model.status ?? "ready",
      input: model.input ?? ["text"],
      output: model.output ?? ["text"],
      context_window: docs?.context_window ?? { display: null, tokens: null },
      released: docs?.released,
      reasoning,
      recommended: docs?.recommended,
      notes: docs ? { advantages: docs.advantages, limitations: docs.limitations } : undefined,
    })
  }

  for (const row of docsRows) {
    if (row.external || row.embeddings || usedDocsRows.has(row)) continue
    gaps.docs_without_api.push(row.name)
  }

  const catalog = {
    generated_at: new Date().toISOString(),
    sources: {
      live_api: `${API_BASE}/models`,
      docs: DOCS_URL,
      reasoning: "scripts/reasoning-models.json (curated; see entry sources)",
      notes:
        "context_window.tokens is derived from the docs display value (k=1e3, M=1e6); the display string preserves the source. External (closed) models are excluded — the SAIA API does not serve them.",
    },
    live: { models: liveModels },
    models,
    gaps,
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(catalog, null, 2)}\n`)

  console.log(`[INFO] wrote ${outPath} (${models.length} models)`)
  for (const [key, value] of Object.entries(gaps)) {
    if (value.length) warn(`${key}: ${value.join(", ")}`)
  }
  if (strict && Object.values(gaps).some((value) => value.length)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`[ERROR] ${error.message}`)
  process.exit(1)
})
