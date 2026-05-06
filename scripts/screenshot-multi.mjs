import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const args = process.argv.slice(2)
const urls = []
let viewport = 375
let prefix = 'extract'
for (const a of args) {
  if (a.startsWith('--viewport=')) viewport = Number(a.split('=')[1])
  else if (a.startsWith('--prefix=')) prefix = a.split('=')[1]
  else urls.push(a)
}
const outDir = resolve(ROOT, 'screenshots')
await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: viewport, height: 667 } })
const page = await ctx.newPage()
for (const url of urls) {
  console.log(`[ss] ${url}`)
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  await page.evaluate(async () => {
    const h = document.body.scrollHeight
    for (let y = 0; y < h; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)) }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(800)
  const slug = (() => { try { return new URL(url).pathname.replace(/\//g, '_').replace(/^_|_$/g, '') || 'root' } catch { return 'unknown' } })()
  const path = resolve(outDir, `${prefix}-${slug}-${viewport}px.png`)
  await page.screenshot({ path, fullPage: true })
  console.log(`  → ${path}`)
}
await browser.close()
