// Captures full-page screenshots side-by-side for visual comparison.
// Usage:
//   node scripts/screenshot.mjs <local-url> <live-url> [--viewport=375] [--name=<file-prefix>]
//
// Writes PNGs into screenshots/ — gitignore that directory.
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
if (args.length < 2) {
  console.error('Usage: node scripts/screenshot.mjs <local-url> <live-url> [--viewport=375] [--name=menu]')
  process.exit(1)
}
const [localUrl, liveUrl, ...rest] = args
let viewport = 375
let name = null
for (const a of rest) {
  if (a.startsWith('--viewport=')) viewport = Number(a.split('=')[1])
  else if (a.startsWith('--name=')) name = a.split('=')[1]
}
if (!name) {
  try { name = new URL(liveUrl).pathname.replace(/\//g, '_').replace(/^_|_$/g, '') || 'page' }
  catch { name = 'page' }
}

const outDir = resolve(ROOT, 'screenshots')
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: viewport, height: 667 } })
const page = await ctx.newPage()

for (const [label, url] of [['local', localUrl], ['live', liveUrl]]) {
  console.log(`[screenshot] ${label}: ${url}`)
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2500) // let IX2 / our PageReveal settle
  // Scroll to bottom and back to top so IntersectionObserver-driven reveals
  // fire across the whole page (otherwise everything below the fold is at
  // opacity 0 in the screenshot).
  await page.evaluate(async () => {
    const h = document.body.scrollHeight
    for (let y = 0; y < h; y += 400) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 100))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(1500)
  const path = resolve(outDir, `${name}-${viewport}px-${label}.png`)
  await page.screenshot({ path, fullPage: true })
  console.log(`  → ${path}`)
}

await browser.close()
