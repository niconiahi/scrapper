#!/usr/bin/env node
import { chromium } from 'playwright'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
if (args.length < 1) {
  console.error('Usage: node scripts/detect-breakpoints.mjs <url> [--wait=load|domcontentloaded] [--timeout=60000]')
  process.exit(1)
}
const [url, ...rest] = args
let waitUntil = 'load'
let timeoutMs = 60_000
for (const arg of rest) {
  if (arg.startsWith('--wait=')) waitUntil = arg.split('=')[1]
  else if (arg.startsWith('--timeout=')) timeoutMs = Number(arg.split('=')[1])
}

const log = (msg) => console.log(`[detect-breakpoints] ${msg}`)

log(`URL: ${url}`)
log('Launching Chromium...')
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

log(`Navigating (waitUntil=${waitUntil})...`)
await page.goto(url, { waitUntil, timeout: timeoutMs })

// Walk all stylesheets, find @media rules, extract numeric thresholds.
const result = await page.evaluate(() => {
  const minWidths = new Map() // px → count of rules using it
  const maxWidths = new Map()
  const orientations = new Set()
  const corsBlocked = []
  const queries = new Map() // raw query text → count

  function walk(rules) {
    for (const rule of rules) {
      // CSSMediaRule
      if (rule.media) {
        const text = rule.media.mediaText || rule.conditionText || ''
        if (text) queries.set(text, (queries.get(text) || 0) + 1)

        // Parse min-width / max-width values (px only — em/rem are rare for layout)
        const minMatches = text.matchAll(/\(min-width:\s*([\d.]+)px\)/gi)
        for (const m of minMatches) {
          const px = Math.round(parseFloat(m[1]))
          minWidths.set(px, (minWidths.get(px) || 0) + 1)
        }
        const maxMatches = text.matchAll(/\(max-width:\s*([\d.]+)px\)/gi)
        for (const m of maxMatches) {
          const px = Math.round(parseFloat(m[1]))
          maxWidths.set(px, (maxWidths.get(px) || 0) + 1)
        }
        if (/portrait/i.test(text)) orientations.add('portrait')
        if (/landscape/i.test(text)) orientations.add('landscape')
      }
      // Recurse into supports/media
      if (rule.cssRules) walk(rule.cssRules)
    }
  }

  for (const sheet of document.styleSheets) {
    try {
      const rules = sheet.cssRules || []
      walk(rules)
    } catch (e) {
      if (sheet.href) corsBlocked.push(sheet.href)
    }
  }

  return {
    minWidths: Object.fromEntries(minWidths),
    maxWidths: Object.fromEntries(maxWidths),
    orientations: [...orientations],
    queries: Object.fromEntries(queries),
    corsBlocked,
  }
})

await browser.close()

const minSorted = Object.entries(result.minWidths).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0])
const maxSorted = Object.entries(result.maxWidths).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0])

console.log('')
log(`min-width thresholds: ${minSorted.length}`)
for (const [px, count] of minSorted) console.log(`  ≥ ${px}px   (used in ${count} rule${count === 1 ? '' : 's'})`)

log(`max-width thresholds: ${maxSorted.length}`)
for (const [px, count] of maxSorted) console.log(`  ≤ ${px}px   (used in ${count} rule${count === 1 ? '' : 's'})`)

if (result.orientations.length) log(`orientations referenced: ${result.orientations.join(', ')}`)

if (result.corsBlocked.length) {
  log(`CORS-blocked stylesheets (rules unreadable): ${result.corsBlocked.length}`)
  for (const u of result.corsBlocked) console.log(`  - ${u}`)
}

// Suggest a capture set: one viewport per "lane" between breakpoints.
const allCutoffs = new Set([
  ...minSorted.map(([px]) => px),
  ...maxSorted.map(([px]) => px + 1), // max-width: N → next lane starts at N+1
])
const cutoffs = [...allCutoffs].sort((a, b) => a - b)

if (cutoffs.length) {
  // Capture WIDTHS one less than each min cutoff (to be in the lane *below* it),
  // plus a width above the largest cutoff. Adjusted to common device widths
  // when one is close enough.
  const COMMON_WIDTHS = [320, 375, 414, 480, 568, 667, 768, 834, 992, 1024, 1280, 1366, 1440, 1536, 1920]
  const pickNear = (target) => {
    let best = COMMON_WIDTHS[0], bestDelta = Math.abs(COMMON_WIDTHS[0] - target)
    for (const w of COMMON_WIDTHS) {
      const d = Math.abs(w - target)
      if (d < bestDelta) { best = w; bestDelta = d }
    }
    return bestDelta <= 32 ? best : target
  }

  const lanes = []
  // Lane below the smallest cutoff
  const smallest = cutoffs[0]
  lanes.push(pickNear(Math.max(320, smallest - 50)))
  // One per lane between cutoffs
  for (let i = 0; i < cutoffs.length - 1; i++) {
    const lo = cutoffs[i]
    const hi = cutoffs[i + 1]
    const mid = Math.floor((lo + hi - 1) / 2)
    lanes.push(pickNear(mid))
  }
  // Lane above the largest cutoff
  const largest = cutoffs[cutoffs.length - 1]
  lanes.push(pickNear(Math.max(1280, largest + 100)))

  const dedup = [...new Set(lanes)].sort((a, b) => a - b)

  console.log('')
  log(`Suggested capture viewports (one per lane):`)
  console.log(`  ${dedup.join(', ')}`)
  console.log('')
  log('Run with:')
  console.log(`  npm run extract:page -- "${url}" ${dedup.map((w) => `--viewport=${w}`).join(' ')}`)
}
