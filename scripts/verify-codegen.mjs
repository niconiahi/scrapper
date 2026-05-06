#!/usr/bin/env node
// Verifies the data-driven invariant of CODEGEN.md §10: every value in the
// gen'd <PascalSlug>.tsx traces back to a captured byte. Exits non-zero on
// the first violation.
//
// Usage:
//   node scripts/verify-codegen.mjs <slug>

import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const GEN_DIR = resolve(ROOT, 'src/components/generated')
const COMP_DIR = resolve(ROOT, 'src/components')

const log = (msg) => console.log(`[verify:codegen] ${msg}`)
const die = (msg) => { console.error(`[verify:codegen] ✗ ${msg}`); process.exit(1) }

const args = process.argv.slice(2)
if (args.length < 1) die('Usage: node scripts/verify-codegen.mjs <slug>')
const slug = args[0]
if (!/^[a-zA-Z0-9_-]+$/.test(slug)) die(`Invalid slug: ${slug}`)

const pascalSlug = slug
  .split(/[-_]/).filter(Boolean)
  .map((p) => p[0].toUpperCase() + p.slice(1)).join('')

async function readMaybe(path, fallback) {
  try { return await readFile(path, 'utf8') }
  catch (err) { if (err.code === 'ENOENT' && fallback !== undefined) return fallback; throw err }
}

const tsxPath = resolve(GEN_DIR, `${pascalSlug}.tsx`)
const tsx = await readMaybe(tsxPath)
if (!tsx) die(`Missing ${tsxPath}. Run codegen first.`)

const treeRaw = await readMaybe(resolve(GEN_DIR, `${slug}.tree.json`))
if (!treeRaw) die(`Missing ${slug}.tree.json`)
const tree = JSON.parse(treeRaw)
const cssRaw = await readMaybe(resolve(GEN_DIR, `${slug}.css`), '')
const linkMapRaw = await readMaybe(resolve(COMP_DIR, 'routes.manifest.json'), '{}')
const linkMap = JSON.parse(linkMapRaw)

// -- gather expected values from captured data -------------------------------

const cssClassNames = new Set()
for (const m of cssRaw.matchAll(/\.([a-zA-Z_][\w-]*)/g)) cssClassNames.add(m[1])

const treeClassNames = new Set()
const treeTextValues = new Set()
const treeSrcValues = new Set()
const treeHrefValues = new Set()
const treeAttrStrings = new Set() // any string captured anywhere — broad bucket

;(function walk(n) {
  if (!n) return
  if (n.type === 'text') {
    if (typeof n.value === 'string') treeTextValues.add(n.value)
    return
  }
  if (Array.isArray(n.classes)) {
    for (const c of n.classes) treeClassNames.add(c)
  }
  if (n.props) {
    for (const [k, v] of Object.entries(n.props)) {
      if (typeof v !== 'string') continue
      treeAttrStrings.add(v)
      if (k === 'src') treeSrcValues.add(v)
      if (k === 'href' || k === 'action') treeHrefValues.add(v)
    }
  }
  if (n.svgMarkup && typeof n.svgMarkup === 'string') {
    // SVG markup may contain nested <text>…</text> values that the parser
    // emits as JSX text. Index plain-text contents so verification finds them.
    for (const m of n.svgMarkup.matchAll(/>([^<]+)</g)) {
      const t = m[1].trim()
      if (t) treeTextValues.add(t)
    }
  }
  for (const c of n.children || []) walk(c)
})(tree)

const linkMapSources = new Set(Object.keys(linkMap))
const linkMapTargets = new Set(Object.values(linkMap))

// -- extract values from the gen'd .tsx --------------------------------------
// Output format is controlled by codegen-page.mjs; we lean on that.

function unwrapJsxString(literal) {
  // Either "..." (no inner quote/brace/etc) or {"..."} (JSON string expr).
  if (literal.startsWith('"') && literal.endsWith('"')) return JSON.parse(literal)
  if (literal.startsWith('{') && literal.endsWith('}')) {
    const inner = literal.slice(1, -1)
    if (inner.startsWith('"') && inner.endsWith('"')) return JSON.parse(inner)
  }
  return null
}

const ATTR_RE = /(\b[a-zA-Z][\w-]*)=("(?:[^"\\]|\\.)*"|\{"(?:[^"\\]|\\.)*"\})/g
const TEXT_EXPR_RE = /\{"((?:[^"\\]|\\.)*)"\}/g

const observed = {
  classNames: [],     // [{ raw, file:line }]
  texts: [],
  hrefs: [],
  srcs: [],
}

const lines = tsx.split('\n')
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  // Attribute scan
  for (const m of line.matchAll(ATTR_RE)) {
    const name = m[1]
    const raw = m[2]
    const value = unwrapJsxString(raw)
    if (value === null) continue
    if (name === 'className') observed.classNames.push({ value, line: i + 1 })
    else if (name === 'href') observed.hrefs.push({ value, line: i + 1 })
    else if (name === 'src') observed.srcs.push({ value, line: i + 1 })
  }
  // Text expression scan — only for {"..."} that is NOT immediately preceded
  // by `=` (those are attribute values, already handled above).
  for (const m of line.matchAll(TEXT_EXPR_RE)) {
    const before = line[m.index - 1]
    if (before === '=') continue
    try { observed.texts.push({ value: JSON.parse(`"${m[1]}"`), line: i + 1 }) } catch {}
  }
}

// -- verify ------------------------------------------------------------------

let failures = 0
const fail = (msg) => { failures++; console.error(`[verify:codegen] ✗ ${msg}`) }

// 1. className tokens — must come from either the captured CSS or the tree.
const knownClasses = new Set([...cssClassNames, ...treeClassNames])
if (knownClasses.size > 0) {
  for (const { value, line } of observed.classNames) {
    for (const tok of value.split(/\s+/).filter(Boolean)) {
      if (!knownClasses.has(tok)) {
        fail(`${pascalSlug}.tsx:${line} — className token "${tok}" not in ${slug}.css or tree.json classes`)
      }
    }
  }
} else {
  log(`(skipping className check — no class data captured)`)
}

// 2. text nodes
for (const { value, line } of observed.texts) {
  if (!treeTextValues.has(value)) {
    fail(`${pascalSlug}.tsx:${line} — text "${truncate(value)}" not found in ${slug}.tree.json`)
  }
}

// 3. hrefs
for (const { value, line } of observed.hrefs) {
  if (value.startsWith('#')) continue
  if (linkMapTargets.has(value)) continue          // produced by rewrite
  if (treeHrefValues.has(value)) continue          // appeared verbatim in capture
  if (treeAttrStrings.has(value)) continue         // some hrefs come from non-href attrs (rare)
  // Also accept hrefs that map to a known source via prefix rewrite.
  let matched = false
  for (const [src, dst] of Object.entries(linkMap)) {
    if (value === dst || value.startsWith(dst + '/') || value.startsWith(dst + '#') || value.startsWith(dst + '?')) {
      const original = src + value.slice(dst.length)
      if (treeHrefValues.has(original)) { matched = true; break }
    }
  }
  if (!matched) fail(`${pascalSlug}.tsx:${line} — href "${truncate(value)}" not traceable to capture or linkMap`)
}

// 4. srcs
for (const { value, line } of observed.srcs) {
  if (treeSrcValues.has(value)) continue
  if (treeAttrStrings.has(value)) continue
  fail(`${pascalSlug}.tsx:${line} — src "${truncate(value)}" not found in ${slug}.tree.json`)
}

function truncate(s) {
  if (s.length <= 80) return s
  return s.slice(0, 77) + '...'
}

if (failures > 0) {
  console.error(`[verify:codegen] ✗ ${failures} violation(s) — codegen has invented or transformed values.`)
  process.exit(1)
}

log(`✓ ${pascalSlug}.tsx is consistent with captured data`)
log(`  classNames : ${observed.classNames.length}`)
log(`  texts      : ${observed.texts.length}`)
log(`  hrefs      : ${observed.hrefs.length}`)
log(`  srcs       : ${observed.srcs.length}`)
