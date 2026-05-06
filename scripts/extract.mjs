#!/usr/bin/env node
import { chromium } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectInPage } from './inspect-in-page.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const t0 = Date.now()
const log = (msg) => {
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2).padStart(6)
  console.log(`[extract +${elapsed}s] ${msg}`)
}

const args = process.argv.slice(2)
if (args.length < 2) {
  console.error('Usage: node scripts/extract.mjs <url> <selector> [--viewport=1440] [--out=path.json] [--wait=load|domcontentloaded|networkidle] [--settle=800] [--timeout=60000]')
  process.exit(1)
}

const [url, selector, ...rest] = args
const viewports = []
let outOverride = null
let waitUntil = 'load'
let settleMs = 800
let timeoutMs = 60_000
let debug = false
for (const arg of rest) {
  if (arg.startsWith('--viewport=')) viewports.push(Number(arg.split('=')[1]))
  else if (arg.startsWith('--out=')) outOverride = arg.split('=')[1]
  else if (arg.startsWith('--wait=')) waitUntil = arg.split('=')[1]
  else if (arg.startsWith('--settle=')) settleMs = Number(arg.split('=')[1])
  else if (arg.startsWith('--timeout=')) timeoutMs = Number(arg.split('=')[1])
  else if (arg === '--debug') debug = true
}
if (viewports.length === 0) viewports.push(1440)

log(`URL          : ${url}`)
log(`Selector     : ${selector}`)
log(`Viewports    : ${viewports.join(', ')}`)
log(`waitUntil    : ${waitUntil}`)
log(`Settle delay : ${settleMs}ms`)
log(`Nav timeout  : ${timeoutMs}ms`)

log('Launching Chromium...')
const browser = await chromium.launch()
log('Chromium ready.')

const outDir = resolve(ROOT, 'scrapped')
await mkdir(outDir, { recursive: true })
log(`Output dir   : ${outDir}`)

const written = []
for (const width of viewports) {
  log(`──────── viewport ${width}px ────────`)
  log(`Creating browser context (${width}x900)...`)
  const context = await browser.newContext({ viewport: { width, height: 900 } })
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

  log(`Waiting for selector "${selector}" to appear (max 15s)...`)
  try {
    await page.waitForSelector(selector, { timeout: 15_000, state: 'attached' })
    log('✓ Target element found in DOM.')
  } catch {
    log(`✗ Selector never appeared. Skipping ${width}px.`)
    await context.close()
    continue
  }

  if (settleMs > 0) {
    log(`Settling ${settleMs}ms (lets Webflow IX2 animations land)...`)
    await page.waitForTimeout(settleMs)
  }

  log('Walking DOM and extracting computed styles...')
  const evalStart = Date.now()
  const result = await page.evaluate(inspectInPage, selector)
  log(`✓ Tree built in ${((Date.now() - evalStart) / 1000).toFixed(2)}s.`)

  if (result.error) {
    log(`✗ ${result.error}`)
    await context.close()
    continue
  }
  log(`  Nodes captured: ${result.nodeCount}`)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outPath = outOverride && viewports.length === 1
    ? resolve(ROOT, outOverride)
    : resolve(outDir, `react-tree-${width}px-${stamp}.json`)
  log(`Writing JSON to ${outPath}...`)
  await writeFile(outPath, JSON.stringify(result.tree, null, 2))
  const sizeKB = (Buffer.byteLength(JSON.stringify(result.tree)) / 1024).toFixed(1)
  log(`✓ Wrote ${sizeKB} KB.`)
  written.push(outPath)

  log('Closing browser context.')
  await context.close()
}

log('Closing browser.')
await browser.close()

if (written.length === 0) {
  log('✗ No files written.')
  process.exit(1)
}
log(`✓ Done. ${written.length} file(s) written.`)
for (const p of written) log(`  → ${p}`)
