#!/usr/bin/env node
import { chromium } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
if (args.length < 1) {
  console.error('Usage: node scripts/extract-ix2.mjs <url> [--out=path.json] [--timeout=60000]')
  process.exit(1)
}
const [url, ...rest] = args
let outOverride = null
let timeoutMs = 60_000
let nameSlug = null
for (const arg of rest) {
  if (arg.startsWith('--out=')) outOverride = arg.split('=')[1]
  else if (arg.startsWith('--timeout=')) timeoutMs = Number(arg.split('=')[1])
  else if (arg.startsWith('--name=')) nameSlug = arg.split('=')[1]
}

const t0 = Date.now()
const log = (msg) => {
  const e = ((Date.now() - t0) / 1000).toFixed(2).padStart(6)
  console.log(`[extract:ix2 +${e}s] ${msg}`)
}

log(`URL: ${url}`)
log('Launching Chromium...')
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()

log(`Navigating...`)
await page.goto(url, { waitUntil: 'load', timeout: timeoutMs })
log('Settling 3000ms (Webflow runtime needs to init IX2)...')
await page.waitForTimeout(3000)

log('Reading IX2 store...')
const ixData = await page.evaluate(() => {
  const ix2 = window.Webflow?.require?.('ix2')
  if (!ix2 || !ix2.store) return { error: 'Webflow.require("ix2") not available' }
  return ix2.store.getState().ixData
})

// Build the data-w-id → preset map from two complementary sources:
//
//  1. Static (ixData.events): for SCROLL_INTO_VIEW events whose target.id is
//     a raw UUID (no `|`), it IS the DOM data-w-id verbatim. This catches
//     elements that IX2 has already revealed by the time we observe (e.g. the
//     header, which fades in immediately on load — at 3s settle it's already
//     at opacity:1 and would be missed by runtime DOM scanning).
//
//  2. Runtime (live DOM scan): for events whose target.id is `fileId|innerId`
//     (elements inside Webflow Symbols/Components), the inner ID does NOT
//     appear as data-w-id in the rendered HTML. The IX2 runtime resolves
//     these via internal mappings we can't statically reconstruct, so we
//     observe what IX2 actually sets on the live DOM and classify each
//     element by its pre-reveal inline style.
//
// We merge both. Static wins when both define an entry (it's authoritative
// from the source data, not state-dependent).
const SUPPORTED = new Set(['growIn', 'fadeIn', 'slideInBottom'])
const staticMap = {}
for (const ev of Object.values(ixData.events || {})) {
  if (ev.eventTypeId !== 'SCROLL_INTO_VIEW') continue
  const effect = ev.action?.config?.actionListId
  if (!effect || !SUPPORTED.has(effect)) continue
  const tid = ev.target?.id || ''
  if (tid.includes('|')) continue // skip symbol-instance refs (need runtime)
  staticMap[tid] = effect
}
log(`Static map (raw-UUID events): ${Object.keys(staticMap).length} entries`)

log('Observing IX2 initial reveal state on the live DOM...')
const runtimeMap = await page.evaluate(() => {
  const out = {}
  const targets = document.querySelectorAll('[data-w-id]')
  for (const el of targets) {
    const id = el.getAttribute('data-w-id')
    if (!id) continue
    const s = el.style
    const op = s.opacity
    const tr = (s.transform || '').toLowerCase()
    if (op === '' || parseFloat(op) > 0.05) continue
    if (tr.includes('scale') && tr.includes('0.75') && !tr.includes('translate')) {
      out[id] = 'growIn'
      continue
    }
    if (tr.includes('translate3d') && /,\s*100/.test(tr)) {
      out[id] = 'slideInBottom'
      continue
    }
    if (/translatey\(\s*100/i.test(tr)) {
      out[id] = 'slideInBottom'
      continue
    }
    if (!tr || tr === 'none' || tr === 'translate3d(0px, 0px, 0px)') {
      out[id] = 'fadeIn'
      continue
    }
  }
  return out
})
log(`Runtime map (live-DOM scan): ${Object.keys(runtimeMap).length} entries`)

// Merge — static authoritative, runtime fills the rest.
const mergedRuntimeMap = { ...runtimeMap, ...staticMap }
log(`✓ Merged map: ${Object.keys(mergedRuntimeMap).length} elements`)

await browser.close()

if (ixData.error) {
  console.error(`✗ ${ixData.error}`)
  process.exit(1)
}

const eventCount = Object.keys(ixData.events || {}).length
const actionListCount = Object.keys(ixData.actionLists || {}).length
log(`✓ Got ${eventCount} events, ${actionListCount} action lists, ${ixData.mediaQueries?.length ?? 0} media queries`)

const outDir = resolve(ROOT, 'scrapped')
await mkdir(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const namePrefix = nameSlug ? `${nameSlug}-` : ''
const outPath = outOverride
  ? resolve(ROOT, outOverride)
  : resolve(outDir, `${namePrefix}ix2-${stamp}.json`)
// Embed the merged map alongside ixData so the build step can use it directly.
const out = { ...ixData, _runtimeMap: mergedRuntimeMap }
const json = JSON.stringify(out, null, 2)
await writeFile(outPath, json)
log(`✓ Wrote ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB → ${outPath}`)
