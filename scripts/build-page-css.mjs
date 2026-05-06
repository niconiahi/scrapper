#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SCRAPPED = resolve(ROOT, 'scrapped')
const GEN_DIR = resolve(ROOT, 'src/components/generated')

const log = (msg) => console.log(`[build:page-css] ${msg}`)
const warn = (msg) => console.warn(`[build:page-css] ⚠ ${msg}`)

async function pickLatest() {
  const entries = await readdir(SCRAPPED)
  const matches = entries
    .filter((f) => f.startsWith('react-page-') && f.endsWith('.json'))
    .sort()
  if (matches.length === 0) {
    console.error('No react-page-*.json found in scrapped/. Run `npm run extract:page` first.')
    process.exit(1)
  }
  return resolve(SCRAPPED, matches[matches.length - 1])
}

const inputArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
const inputPath = inputArg ? resolve(ROOT, inputArg) : await pickLatest()
log(`Source : ${inputPath}`)

const raw = JSON.parse(await readFile(inputPath, 'utf8'))

// Normalize to: captures = [{ viewport, height, tree, context }, ...]
let captures
if (raw.multi && Array.isArray(raw.captures)) {
  captures = [...raw.captures].sort((a, b) => a.viewport - b.viewport)
  log(`Multi-capture: ${captures.map((c) => `${c.viewport}x${c.height}`).join(', ')}`)
} else if (raw.tree && raw.context) {
  captures = [{ viewport: raw.viewport, height: 0, tree: raw.tree, context: raw.context, sourceRules: raw.sourceRules || [] }]
  log(`Single-capture: ${raw.viewport}px`)
} else {
  console.error('Unknown JSON shape — expected { tree, context } or { multi: true, captures: [...] }')
  process.exit(1)
}

const toKebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

const NOISE_PROPS = new Set([
  'transformOrigin', 'transition', 'objectFit', 'objectPosition',
  'flexShrink', 'flex', 'outline',
])
const NOISE_VALUES = {
  flexDirection: ['row'],
  display: ['inline'],
  position: ['static'],
  backgroundPosition: ['0% 0%'],
  objectFit: ['fill'],
  objectPosition: ['50% 50%'],
  transition: ['all'],
  flex: ['0 1 auto'],
  flexShrink: ['1'],
}

function emitProps(styles) {
  const lines = []
  for (const [k, v] of Object.entries(styles)) {
    if (NOISE_PROPS.has(k)) {
      const noise = NOISE_VALUES[k]
      if (noise && noise.includes(v)) continue
      if (NOISE_PROPS.has(k) && !noise) continue
    }
    const noise = NOISE_VALUES[k]
    if (noise && noise.includes(v)) continue
    lines.push(`  ${toKebab(k)}: ${v};`)
  }
  return lines
}

// Filter raw style object once with the same noise rules. Returns an object.
function filterStyles(styles) {
  const out = {}
  for (const [k, v] of Object.entries(styles)) {
    if (NOISE_PROPS.has(k)) {
      const noise = NOISE_VALUES[k]
      if (noise && noise.includes(v)) continue
      if (NOISE_PROPS.has(k) && !noise) continue
    }
    const noise = NOISE_VALUES[k]
    if (noise && noise.includes(v)) continue
    out[k] = v
  }
  return out
}

// Walk N trees in parallel; for each node yield the per-capture styles array.
function alignAndCollect(captures) {
  // selector → [base styles, {viewport: overrides}, ...]
  // We use Map<selector, perCaptureStyles[]>
  const ruleMap = new Map() // selector → [{...}, {...}, ...] aligned to captures order
  const pseudoMap = new Map()

  function walkAll(nodes) {
    if (!nodes || !nodes[0]) return
    const head = nodes[0]
    if (head.type === 'text') return // text node — no styles

    const classes = head.classes
    if (classes && classes.length) {
      const selector = '.' + classes.join('.')
      // Collect filtered styles per capture (using each capture's tree node)
      const perCap = nodes.map((n) => filterStyles(n.styles || {}))
      // Only emit if any capture has anything
      if (perCap.some((s) => Object.keys(s).length)) {
        ruleMap.set(selector, perCap)
      }

      // Pseudo elements — Webflow's IX2 sometimes only animates pseudo on
      // certain breakpoints. Collect per-capture per-pseudo independently.
      for (const pseudoKey of ['::before', '::after']) {
        const perCapPseudo = nodes.map((n) => {
          const p = n.pseudo?.[pseudoKey]
          return p ? filterStyles(p) : {}
        })
        if (perCapPseudo.some((s) => Object.keys(s).length)) {
          pseudoMap.set(selector + pseudoKey, perCapPseudo)
        }
      }
    }

    // Recurse into children. Align by index. If child counts diverge, take
    // the max and pass `null`-like skipped branches.
    const childCounts = nodes.map((n) => (n.children?.length || 0))
    const maxChildren = Math.max(...childCounts)
    if (childCounts.some((c) => c !== maxChildren)) {
      warn(`Tree divergence at ${classes?.join('.') ?? head.tag}: child counts ${childCounts.join(' vs ')}`)
    }
    for (let i = 0; i < maxChildren; i++) {
      const childNodes = nodes.map((n) => n.children?.[i]).filter(Boolean)
      if (childNodes.length === nodes.length) {
        walkAll(childNodes)
      }
      // else: skip — node doesn't exist in all captures, can't align styles
    }
  }

  walkAll(captures.map((c) => c.tree))
  return { ruleMap, pseudoMap }
}

// Diff a list of style objects: return { base, byViewport: { vp: { onlyDiffs } } }
function diffStyles(perCap, viewports) {
  const base = perCap[0] || {}
  const byViewport = {}
  for (let i = 1; i < perCap.length; i++) {
    const overrides = {}
    const cap = perCap[i] || {}
    const allKeys = new Set([...Object.keys(base), ...Object.keys(cap)])
    for (const k of allKeys) {
      const bv = base[k]
      const cv = cap[k]
      if (bv !== cv) {
        // Use the larger viewport's value — even if it's missing, encode that
        // by writing 'unset' so the cascade doesn't inherit base.
        overrides[k] = cv ?? 'unset'
      }
    }
    if (Object.keys(overrides).length) byViewport[viewports[i]] = overrides
  }
  return { base, byViewport }
}

function emitObjectAsLines(obj) {
  return Object.entries(obj).map(([k, v]) => `  ${toKebab(k)}: ${v};`)
}

const viewports = captures.map((c) => c.viewport)

// Page-level context — pull from the smallest viewport for everything except
// the html/body computed styles, which we also diff across captures.
const baseContext = captures[0].context

const sections = []

// Families handled by npm packages (Fontsource, next/font/local) — drop their
// @font-face declarations so we don't double-load.
const HANDLED_FAMILIES = new Set(['arima', 'dm sans', 'open sans'])
const familyOf = (faceText) => {
  const m = faceText.match(/font-family\s*:\s*['"]?([^;'"\n]+?)['"]?\s*;/i)
  return m ? m[1].trim().toLowerCase() : null
}
if (baseContext.fontFaces && baseContext.fontFaces.length) {
  const kept = baseContext.fontFaces.filter((face) => {
    const fam = familyOf(face)
    return fam ? !HANDLED_FAMILIES.has(fam) : true
  })
  const dropped = baseContext.fontFaces.length - kept.length
  if (kept.length) {
    sections.push('/* @font-face — captured from source page (Fontsource handles Arima/DM Sans/Open Sans) */')
    sections.push(kept.join('\n\n'))
  }
  log(`@font-face: ${kept.length} kept, ${dropped} dropped (handled by Fontsource)`)
}

if (baseContext.cssVars && Object.keys(baseContext.cssVars).length) {
  const vars = Object.entries(baseContext.cssVars).map(([k, v]) => `  ${k}: ${v};`)
  sections.push(`/* :root CSS variables — captured from source page */\n:root {\n${vars.join('\n')}\n}`)
}

// === Verbatim source CSS rules ===
//
// Instead of synthesizing rules from computed styles (which lossy-resolves
// %, vh, calc, etc. into pixels at the capture viewport), copy the source
// stylesheets' rules verbatim — preserving original units, selectors, and
// @media wrappers. The browser's natural cascade does the rest.
//
// We dedupe across captures (same selector + media + cssText counted once).
// If the same selector appears in multiple captures with different cssText
// — e.g. a media-query rule a smaller viewport doesn't match — both are
// emitted; the browser picks based on the active viewport.

const allRules = []
const seenKey = new Set()
for (const cap of captures) {
  for (const r of cap.sourceRules || []) {
    const key = (r.mediaCondition || '') + '||' + r.cssText
    if (seenKey.has(key)) continue
    seenKey.add(key)
    allRules.push(r)
  }
}
log(`Source rules: ${allRules.length} unique`)

sections.push('/* Source CSS rules (verbatim from captured stylesheets) */')

// Group rules by media condition to emit clean @media blocks.
const byMedia = new Map() // mediaCondition (or '') → array of cssText
for (const r of allRules) {
  const m = r.mediaCondition || ''
  if (!byMedia.has(m)) byMedia.set(m, [])
  byMedia.get(m).push(r.cssText)
}

// Emit non-media rules first (the "base"), then each @media block — but
// ORDERED so the cascade resolves correctly when multiple queries match.
//
// For `max-width` queries: smaller max should win at narrow viewports → emit
// LARGEST max first, SMALLEST last. For `min-width` queries: larger min should
// win at wide viewports → emit SMALLEST min first, LARGEST last. (Map's
// insertion order from the captured stylesheets is not guaranteed to match
// either pattern, so we enforce it here.)
const baseRules = byMedia.get('') || []
if (baseRules.length) sections.push(baseRules.join('\n'))

const mediaEntries = [...byMedia.entries()].filter(([m]) => m)
const parseSize = (cond, kind) => {
  const m = cond.match(new RegExp(`${kind}\\s*:\\s*(\\d+)\\s*px`))
  return m ? Number(m[1]) : null
}
mediaEntries.sort(([a], [b]) => {
  const aMax = parseSize(a, 'max-width')
  const bMax = parseSize(b, 'max-width')
  const aMin = parseSize(a, 'min-width')
  const bMin = parseSize(b, 'min-width')
  // max-width queries: descending (largest first → smallest last → narrowest viewport gets it last → wins)
  if (aMax != null && bMax != null) return bMax - aMax
  // min-width queries: ascending (smallest first → largest last → widest viewport gets it last → wins)
  if (aMin != null && bMin != null) return aMin - bMin
  // Mixed: max-width queries before min-width (arbitrary but stable)
  if (aMax != null) return -1
  if (bMax != null) return 1
  return a.localeCompare(b)
})

for (const [media, rules] of mediaEntries) {
  const inner = rules.map((t) => '  ' + t.replace(/\n/g, '\n  ')).join('\n')
  sections.push(`@media ${media} {\n${inner}\n}`)
}

const sourceLabel = inputPath.split('/').pop()
const vpLabel = captures.map((c) => `${c.viewport}x${c.height}`).join(', ')
const cssOut = `/* Generated by scripts/build-page-css.mjs from ${sourceLabel} (viewports ${vpLabel}). Do not edit by hand. */\n\n${sections.join('\n\n')}\n`
const cssPath = resolve(GEN_DIR, 'page.css')
await writeFile(cssPath, cssOut)
log(`✓ Wrote ${cssPath} (${(Buffer.byteLength(cssOut) / 1024).toFixed(1)} KB)`)

// Renderer needs ONE tree. Use the smallest viewport's tree (mobile-first).
// Inline styles preserved verbatim from that capture; warn if they differ
// across captures (rare — usually only when JS sets them per-breakpoint).
const baseTree = captures[0].tree
function checkInlineStyleDivergence() {
  if (captures.length < 2) return
  let count = 0
  function walkNodes(nodes) {
    const head = nodes[0]
    if (!head || head.type === 'text') return
    const inline0 = head.inlineStyle
    for (let i = 1; i < nodes.length; i++) {
      if ((nodes[i]?.inlineStyle ?? null) !== (inline0 ?? null)) {
        count++
        break
      }
    }
    const childCounts = nodes.map((n) => (n.children?.length || 0))
    const m = Math.max(...childCounts)
    for (let i = 0; i < m; i++) {
      const childNodes = nodes.map((n) => n.children?.[i]).filter(Boolean)
      if (childNodes.length === nodes.length) walkNodes(childNodes)
    }
  }
  walkNodes(captures.map((c) => c.tree))
  if (count) {
    warn(`Inline styles differ at ${count} node(s) across breakpoints. Renderer uses the smallest viewport's value.`)
  }
}
checkInlineStyleDivergence()

const treeOut = resolve(GEN_DIR, 'page.tree.json')
await writeFile(treeOut, JSON.stringify(baseTree, null, 2))
log(`✓ Wrote ${treeOut}`)

if (baseContext.stylesheetUrls && baseContext.stylesheetUrls.length) {
  const manifestPath = resolve(GEN_DIR, 'page.stylesheets.json')
  await writeFile(manifestPath, JSON.stringify(baseContext.stylesheetUrls, null, 2))
  log(`✓ Wrote ${manifestPath} (${baseContext.stylesheetUrls.length} link URLs)`)
}

log('Done.')
