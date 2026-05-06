#!/usr/bin/env node
// Reads the latest IX2 timeline JSON in scrapped/ and emits two files:
//   src/components/generated/page.animations.css   — keyframes + per-effect rules
//   src/components/generated/page.animations.json  — data-w-id → effect-name map
//
// v1 scope: SCROLL_INTO_VIEW events only (76% of all animations on the
// captured site, all routed through 3 stock Webflow presets: growIn, fadeIn,
// slideInBottom). Hover/click/dropdown are intentionally deferred — they're
// not what's visually missing, and they'd need richer wiring.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SCRAPPED = resolve(ROOT, 'scrapped')
const GEN_DIR = resolve(ROOT, 'src/components/generated')

const log = (msg) => console.log(`[build:ix2] ${msg}`)
const warn = (msg) => console.warn(`[build:ix2] ⚠ ${msg}`)

// --name=<slug> scopes both input picker (`<slug>-ix2-*.json`) and the generated
// output filenames (`<slug>.animations.css`, `<slug>.animations.json`). Default
// slug is `page` to keep the existing pipeline working unchanged.
const argv = process.argv.slice(2)
const nameFlag = argv.find((a) => a.startsWith('--name='))
const nameSlug = nameFlag ? nameFlag.split('=')[1] : null
const outName = nameSlug || 'page'
const inputPrefix = nameSlug ? `${nameSlug}-ix2-` : 'ix2-'

async function pickLatest() {
  const entries = await readdir(SCRAPPED)
  const matches = entries.filter((f) => f.startsWith(inputPrefix) && f.endsWith('.json')).sort()
  if (!matches.length) {
    console.error(`No ${inputPrefix}*.json found in scrapped/. Run \`npm run extract:ix2 -- <url>${nameSlug ? ` --name=${nameSlug}` : ''}\` first.`)
    process.exit(1)
  }
  return resolve(SCRAPPED, matches[matches.length - 1])
}

const inputArg = argv.find((a) => !a.startsWith('--'))
const inputPath = inputArg ? resolve(ROOT, inputArg) : await pickLatest()
log(`Source: ${inputPath}`)
log(`Output: <generated>/${outName}.animations.{css,json}`)

const ixData = JSON.parse(await readFile(inputPath, 'utf8'))

// data-w-id → effect comes from the runtime observation embedded by
// extract-ix2.mjs. The IX2 events use design-time IDs (sometimes
// `fileId|innerId` for elements inside symbols/components) that don't appear
// verbatim as data-w-id in the rendered DOM, so static parsing of events
// loses most matches. The runtime map records what IX2 actually did to the
// live DOM during initial reveal — the source of truth.
const SUPPORTED_EFFECTS = new Set(['growIn', 'fadeIn', 'slideInBottom'])
const map = ixData._runtimeMap || {}
if (!Object.keys(map).length) {
  warn('No _runtimeMap found in ix2 JSON. Re-run `npm run extract:ix2 -- <url>` with the latest extractor.')
}
log(`Runtime-observed reveal elements: ${Object.keys(map).length}`)

// Pull duration/easing/delta from the actual action lists (so if Webflow
// changes the preset, our CSS reflects that). Fallback to canonical defaults
// if a preset isn't in the data.
function paramsFor(effectId) {
  const al = ixData.actionLists?.[effectId]
  const out = { duration: 800, delay: 0, easing: 'ease-out', initial: {}, target: {} }
  if (!al) return out
  // IX2 action lists: all groups except the last are zero-duration setters
  // for the initial (pre-reveal) state. The LAST group is the animated
  // target with the real duration/easing.
  const groups = al.actionItemGroups || []
  if (!groups.length) return out
  const initialGroups = groups.slice(0, -1)
  const targetGroup = groups[groups.length - 1]

  // Round to 3 decimals to avoid 0.7500000000000001 noise from float math.
  const round = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n)

  const apply = (item, bucket) => {
    const c = item.config || {}
    if (item.actionTypeId === 'STYLE_OPACITY') bucket.opacity = round(c.value)
    if (item.actionTypeId === 'TRANSFORM_SCALE') {
      bucket.scaleX = round(c.xValue ?? c.scaleX ?? c.value)
      bucket.scaleY = round(c.yValue ?? c.scaleY ?? c.value)
    }
    if (item.actionTypeId === 'TRANSFORM_MOVE') {
      bucket.translateX = round(c.xValue ?? 0)
      bucket.translateY = round(c.yValue ?? 0)
      // CSS units must be lowercase. IX2 stores them as 'PX', 'EM', etc.
      bucket.translateUnit = (c.yUnit || c.xUnit || 'px').toLowerCase()
    }
  }
  for (const g of initialGroups) {
    for (const i of g.actionItems || []) apply(i, out.initial)
  }
  for (const i of targetGroup.actionItems || []) {
    apply(i, out.target)
    if (typeof i.config?.duration === 'number') out.duration = i.config.duration
    if (typeof i.config?.delay === 'number') out.delay = Math.max(out.delay, i.config.delay)
    if (i.config?.easing) out.easing = i.config.easing
  }
  return out
}

function transformString(b) {
  const parts = []
  if (typeof b.scaleX === 'number' || typeof b.scaleY === 'number') {
    parts.push(`scale(${b.scaleX ?? 1}, ${b.scaleY ?? 1})`)
  }
  if (typeof b.translateX === 'number' || typeof b.translateY === 'number') {
    const u = b.translateUnit || 'px'
    parts.push(`translate(${b.translateX ?? 0}${u}, ${b.translateY ?? 0}${u})`)
  }
  return parts.length ? parts.join(' ') : 'none'
}

// Webflow easing strings → CSS cubic-bezier
const EASING_MAP = {
  '': 'ease-out',
  'ease': 'ease',
  'ease-in': 'ease-in',
  'ease-out': 'ease-out',
  'ease-in-out': 'ease-in-out',
  'inOutQuad': 'cubic-bezier(0.45, 0, 0.55, 1)',
  'inOutCubic': 'cubic-bezier(0.65, 0, 0.35, 1)',
  'inOutQuart': 'cubic-bezier(0.76, 0, 0.24, 1)',
  'inOutSine': 'cubic-bezier(0.37, 0, 0.63, 1)',
  'outQuad': 'cubic-bezier(0.5, 1, 0.89, 1)',
  'outCubic': 'cubic-bezier(0.33, 1, 0.68, 1)',
  'outQuart': 'cubic-bezier(0.25, 1, 0.5, 1)',
}
const cssEasing = (e) => EASING_MAP[e] ?? e ?? 'ease-out'

const cssBlocks = []
cssBlocks.push(`/* Generated by scripts/build-ix2-runtime.mjs from ${inputPath.split('/').pop()}. */
/* Reveals elements with data-anim="..." once they enter the viewport via the
   PageAnimations client component (which adds .is-visible to each). */`)

for (const effect of SUPPORTED_EFFECTS) {
  const p = paramsFor(effect)
  const initialOpacity = typeof p.initial.opacity === 'number' ? p.initial.opacity : 0
  const initialT = transformString(p.initial)
  const finalOpacity = typeof p.target.opacity === 'number' ? p.target.opacity : 1
  const finalT = transformString(p.target)
  cssBlocks.push(`/* ${effect} — IX2 preset */
[data-anim="${effect}"] {
  opacity: ${initialOpacity};
  transform: ${initialT};
  will-change: opacity, transform;
}
[data-anim="${effect}"].is-visible {
  opacity: ${finalOpacity};
  transform: ${finalT};
  transition: opacity ${p.duration}ms ${cssEasing(p.easing)} ${p.delay}ms,
              transform ${p.duration}ms ${cssEasing(p.easing)} ${p.delay}ms;
}`)
}

cssBlocks.push(`/* Respect reduced-motion preference */
@media (prefers-reduced-motion: reduce) {
  [data-anim] {
    opacity: 1 !important;
    transform: none !important;
    transition: none !important;
  }
}`)

const cssOut = cssBlocks.join('\n\n') + '\n'
const cssPath = resolve(GEN_DIR, `${outName}.animations.css`)
await writeFile(cssPath, cssOut)
log(`✓ Wrote ${cssPath} (${(Buffer.byteLength(cssOut) / 1024).toFixed(1)} KB)`)

const mapPath = resolve(GEN_DIR, `${outName}.animations.json`)
await writeFile(mapPath, JSON.stringify(map, null, 2))
log(`✓ Wrote ${mapPath} (${Object.keys(map).length} entries)`)

log('Done.')
