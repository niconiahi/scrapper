#!/usr/bin/env node
import { chromium } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectInPage, capturePageContext, captureSourceRules } from './inspect-in-page.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const t0 = Date.now()
const log = (msg) => {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2).padStart(6)
  console.log(`[extract:page +${elapsed}s] ${msg}`)
}

const args = process.argv.slice(2)
if (args.length < 1) {
  console.error('Usage: node scripts/extract-page.mjs <url> [--viewport=375 --viewport=768 ...] [--height=900] [--heights=375:667,768:1024,1280:800] [--out=path.json] [--wait=load|domcontentloaded|networkidle] [--settle=3000] [--timeout=60000] [--debug]')
  process.exit(1)
}

// Sensible default heights per width — matters for `position: fixed; bottom: ...`
// resolution. Override per-viewport with --heights=375:667,768:1024,...
const DEFAULT_HEIGHT_BY_WIDTH = {
  320: 568,
  375: 667,
  414: 736,
  480: 800,
  768: 1024,
  1024: 768,
  1280: 800,
  1440: 900,
  1920: 1080,
}

const [url, ...rest] = args
const viewports = []
let outOverride = null
let waitUntil = 'load'
let settleMs = 3000
let timeoutMs = 60_000
let debug = false
let heightFlag = null
let nameSlug = null // when set, output filename becomes `<slug>-react-page-…json`
const heightOverrides = {}
for (const arg of rest) {
  if (arg.startsWith('--viewport=')) viewports.push(Number(arg.split('=')[1]))
  else if (arg.startsWith('--height=')) heightFlag = Number(arg.split('=')[1])
  else if (arg.startsWith('--heights=')) {
    for (const pair of arg.split('=')[1].split(',')) {
      const [w, h] = pair.split(':').map(Number)
      if (w && h) heightOverrides[w] = h
    }
  }
  else if (arg.startsWith('--out=')) outOverride = arg.split('=')[1]
  else if (arg.startsWith('--wait=')) waitUntil = arg.split('=')[1]
  else if (arg.startsWith('--settle=')) settleMs = Number(arg.split('=')[1])
  else if (arg.startsWith('--timeout=')) timeoutMs = Number(arg.split('=')[1])
  else if (arg.startsWith('--name=')) nameSlug = arg.split('=')[1]
  else if (arg === '--debug') debug = true
}
if (viewports.length === 0) viewports.push(1440)

const heightFor = (width) =>
  heightOverrides[width] ?? heightFlag ?? DEFAULT_HEIGHT_BY_WIDTH[width] ?? 900

// Fetch CORS-blocked stylesheets via Node fetch (no CORS) and extract any
// @font-face blocks. Google Fonts content-negotiates on UA — we send a modern
// Chrome UA so it returns the same WOFF2 declarations the browser sees.
async function fetchBlockedFontFaces(urls) {
  const out = []
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': ua } })
      if (!res.ok) {
        log(`  ✗ ${res.status} ${res.statusText} for ${url}`)
        continue
      }
      const text = await res.text()
      const matches = text.match(/@font-face\s*\{[\s\S]*?\}/g) || []
      out.push(...matches)
    } catch (e) {
      log(`  ✗ fetch error for ${url}: ${e.message}`)
    }
  }
  return out
}

log(`URL          : ${url}`)
log(`Mode         : full page (root: body)`)
log(`Viewports    : ${viewports.map((w) => `${w}x${heightFor(w)}`).join(', ')}`)
log(`waitUntil    : ${waitUntil}`)
log(`Settle delay : ${settleMs}ms`)
log(`Nav timeout  : ${timeoutMs}ms`)

log('Launching Chromium...')
const browser = await chromium.launch()
log('Chromium ready.')

const outDir = resolve(ROOT, 'scrapped')
await mkdir(outDir, { recursive: true })
log(`Output dir   : ${outDir}`)

const captures = []

for (const width of viewports) {
  const height = heightFor(width)
  log(`──────── viewport ${width}x${height} ────────`)
  log(`Creating browser context (${width}x${height})...`)
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()

  if (debug) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') log(`  [page console error] ${msg.text()}`)
    })
    page.on('requestfailed', (req) => {
      const short = req.url().length > 120 ? req.url().slice(0, 120) + '…' : req.url()
      log(`  [request failed] ${short} — ${req.failure()?.errorText}`)
    })
  }

  log(`Navigating to ${url} (waitUntil=${waitUntil}, timeout=${timeoutMs}ms)...`)
  const navStart = Date.now()
  try {
    await page.goto(url, { waitUntil, timeout: timeoutMs })
  } catch (err) {
    log(`✗ Navigation failed after ${((Date.now() - navStart) / 1000).toFixed(2)}s: ${err.message.split('\n')[0]}`)
    log('  Try: --wait=domcontentloaded  or raise --timeout=120000')
    await context.close()
    continue
  }
  log(`✓ Page loaded in ${((Date.now() - navStart) / 1000).toFixed(2)}s.`)

  if (settleMs > 0) {
    log(`Settling ${settleMs}ms (lets fonts + IX2 animations land)...`)
    await page.waitForTimeout(settleMs)
  }

  // Force scroll to top — getBoundingClientRect (used to compute position:
  // fixed top/left) depends on scroll. IX2 sometimes auto-scrolls.
  await page.evaluate(() => window.scrollTo(0, 0))

  log('Capturing page-level context (html/body/root vars/@font-face/links)...')
  const ctxStart = Date.now()
  const ctx = await page.evaluate(capturePageContext)
  log(`✓ Page context captured in ${((Date.now() - ctxStart) / 1000).toFixed(2)}s.`)
  log(`  @font-face rules from accessible sheets: ${ctx.fontFaces.length}`)

  // Server-side fetch CORS-blocked stylesheets (typically Google Fonts) so we
  // can also extract their @font-face rules. Node fetch has no CORS to obey.
  if (ctx.corsBlocked && ctx.corsBlocked.length) {
    log(`Fetching ${ctx.corsBlocked.length} CORS-blocked sheet(s) server-side for @font-face rules...`)
    const recovered = await fetchBlockedFontFaces(ctx.corsBlocked)
    if (recovered.length) {
      log(`  Recovered ${recovered.length} additional @font-face rules`)
      ctx.fontFaces.push(...recovered)
    } else {
      log(`  No @font-face rules found in blocked sheets.`)
    }
  }

  log('Walking full body DOM and extracting computed styles...')
  const evalStart = Date.now()
  const result = await page.evaluate(inspectInPage, 'body')
  log(`✓ Tree built in ${((Date.now() - evalStart) / 1000).toFixed(2)}s.`)
  if (result.error) {
    log(`✗ ${result.error}`)
    await context.close()
    continue
  }
  log(`  Nodes captured: ${result.nodeCount}`)

  log('Capturing matching source CSS rules (verbatim from stylesheets)...')
  const rulesStart = Date.now()
  const sourceRules = await page.evaluate(captureSourceRules, 'body')
  log(`✓ Source rules captured in ${((Date.now() - rulesStart) / 1000).toFixed(2)}s. ${sourceRules.ruleCount ?? 0} rules.`)

  captures.push({ viewport: width, height, tree: result.tree, context: ctx, sourceRules: sourceRules.rules || [] })

  log('Closing browser context.')
  await context.close()
}

log('Closing browser.')
await browser.close()

if (captures.length === 0) {
  log('✗ No captures.')
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

// When --name=<slug> is provided, prefix the file so build-page-css can
// pick the right capture for that page (e.g. `menu-react-page-375px-…`).
const namePrefix = nameSlug ? `${nameSlug}-` : ''

if (captures.length === 1) {
  // Single-viewport: keep legacy file shape so existing tooling works.
  const cap = captures[0]
  const payload = { tree: cap.tree, context: cap.context, viewport: cap.viewport, sourceRules: cap.sourceRules }
  const outPath = outOverride
    ? resolve(ROOT, outOverride)
    : resolve(outDir, `${namePrefix}react-page-${cap.viewport}px-${stamp}.json`)
  const json = JSON.stringify(payload, null, 2)
  await writeFile(outPath, json)
  log(`✓ Wrote ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB → ${outPath}`)
} else {
  // Multi-viewport: write a combined file. build-page-css detects this shape
  // and emits base + media-query overrides.
  const payload = { multi: true, captures }
  const widths = captures.map((c) => c.viewport).sort((a, b) => a - b).join('-')
  const outPath = outOverride
    ? resolve(ROOT, outOverride)
    : resolve(outDir, `${namePrefix}react-page-multi-${widths}-${stamp}.json`)
  const json = JSON.stringify(payload, null, 2)
  await writeFile(outPath, json)
  log(`✓ Wrote ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB → ${outPath}`)
  log(`  Captures: ${captures.map((c) => `${c.viewport}x${c.height}`).join(', ')}`)
}
