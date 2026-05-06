#!/usr/bin/env node
// Phase A flat codegen.
// Walks <slug>.tree.json and emits a real React component <PascalSlug>.tsx,
// replacing the runtime PageRenderer interpreter. See CODEGEN.md for the spec.
//
// Usage:
//   node scripts/codegen-page.mjs <slug> [--out=path.tsx]
//
// Inputs (read from src/components/generated/ and src/components/):
//   <slug>.tree.json            DOM IR
//   <slug>.animations.json      data-w-id → effect map (optional)
//   routes.manifest.json        link map (optional)
//   shared/manifest.json        skip signatures from extract_components (optional)
//
// Output:
//   src/components/generated/<PascalSlug>.tsx

import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const GEN_DIR = resolve(ROOT, 'src/components/generated')
const COMP_DIR = resolve(ROOT, 'src/components')
const SHARED_DIR = resolve(COMP_DIR, 'shared')

const log = (msg) => console.log(`[codegen:page] ${msg}`)
const die = (msg) => { console.error(`[codegen:page] ✗ ${msg}`); process.exit(1) }

// -- args ---------------------------------------------------------------------

const args = process.argv.slice(2)
if (args.length < 1) die('Usage: node scripts/codegen-page.mjs <slug> [--out=path.tsx]')

const slug = args[0]
let outOverride = null
for (const a of args.slice(1)) {
  if (a.startsWith('--out=')) outOverride = a.split('=')[1]
  else die(`Unknown flag: ${a}`)
}
if (!/^[a-zA-Z0-9_-]+$/.test(slug)) die(`Invalid slug: ${slug}`)

const pascalSlug = slug
  .split(/[-_]/)
  .filter(Boolean)
  .map((p) => p[0].toUpperCase() + p.slice(1))
  .join('')

// -- inputs -------------------------------------------------------------------

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback
    throw err
  }
}

const tree = await readJson(resolve(GEN_DIR, `${slug}.tree.json`))
if (!tree) die(`Could not load tree.json for slug "${slug}"`)
const animMap = await readJson(resolve(GEN_DIR, `${slug}.animations.json`), {})
const linkMap = await readJson(resolve(COMP_DIR, 'routes.manifest.json'), {})
const sharedManifest = await readJson(resolve(SHARED_DIR, 'manifest.json'), {})
// Phase B output (optional). When present, codegen lifts matching subtrees
// into local helper components inside the generated file. See CODEGEN.md §9.
const subcomponents = await readJson(resolve(GEN_DIR, `${slug}.subcomponents.json`), [])

// Build skip set from shared manifest.
const skipSet = new Set()
for (const entry of Object.values(sharedManifest)) {
  for (const sig of entry.skipFromTree || []) skipSet.add(sig)
}

const outPath = outOverride
  ? resolve(ROOT, outOverride)
  : resolve(GEN_DIR, `${pascalSlug}.tsx`)

// -- constants ----------------------------------------------------------------

const VOID_TAGS = new Set([
  'img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'area', 'base', 'col',
  'embed', 'param', 'track', 'wbr',
])

const STRIP_TAGS = new Set(['script', 'noscript', 'link', 'meta', 'style'])

const RESERVED_PROP_KEYS = new Set(['_base64Note', '_svgNote', '[onClick]'])

// IX2 runtime-injected style keys; stripped per the rationale in
// PageRenderer.tsx (animated nodes need to start at the CSS-defined initial
// state, not whatever IX2 had set when Playwright captured the DOM).
const IX2_INJECTED_STYLE_KEYS = new Set(['opacity', 'transform', 'transformStyle'])

// -- helpers ------------------------------------------------------------------

function isText(n) { return n && n.type === 'text' }

function subtreeMatchesSkip(node) {
  if (!skipSet.size || isText(node)) return false
  const sig = (node.classes || []).join(' ')
  if (sig && skipSet.has(sig)) return true
  for (const c of node.children || []) if (subtreeMatchesSkip(c)) return true
  return false
}

function rewriteLink(href) {
  if (!href || href.startsWith('#')) return href
  if (linkMap[href]) return linkMap[href]
  for (const [source, local] of Object.entries(linkMap)) {
    if (
      href === source ||
      href.startsWith(source + '/') ||
      href.startsWith(source + '#') ||
      href.startsWith(source + '?')
    ) return local + href.slice(source.length)
  }
  return href
}

function parseStyleString(raw) {
  const out = {}
  for (const decl of raw.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim()
    const value = decl.slice(i + 1).trim()
    if (!prop || !value) continue
    out[prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value
  }
  return out
}

const HTML_TO_JSX_ATTR = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  rowspan: 'rowSpan',
  colspan: 'colSpan',
  usemap: 'useMap',
  frameborder: 'frameBorder',
  contenteditable: 'contentEditable',
  crossorigin: 'crossOrigin',
  autoplay: 'autoPlay',
  autofocus: 'autoFocus',
  autocomplete: 'autoComplete',
  spellcheck: 'spellCheck',
  srcset: 'srcSet',
  srcdoc: 'srcDoc',
  novalidate: 'noValidate',
  formaction: 'formAction',
  formmethod: 'formMethod',
  formnovalidate: 'formNoValidate',
  formtarget: 'formTarget',
  inputmode: 'inputMode',
  enctype: 'encType',
  acceptcharset: 'acceptCharset',
  accesskey: 'accessKey',
}

function htmlAttrToJsx(name) {
  if (name.startsWith('data-') || name.startsWith('aria-')) return name
  if (name in HTML_TO_JSX_ATTR) return HTML_TO_JSX_ATTR[name]
  if (name.includes('-')) return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  return name
}

// JSX-form attribute names whose React types require `number`. Captured
// values are always strings; for these we emit `attr={N}` when the value
// parses cleanly as an integer (e.g. `tabIndex="0"` → `tabIndex={0}`).
const NUMERIC_HTML_ATTRS = new Set([
  'tabIndex', 'width', 'height', 'rowSpan', 'colSpan',
  'size', 'start', 'span', 'marginHeight', 'marginWidth',
])

function renderHtmlAttrValue(jsxName, value) {
  if (typeof value === 'string' && NUMERIC_HTML_ATTRS.has(jsxName) && /^-?\d+$/.test(value)) {
    return `{${value}}`
  }
  return renderAttrValue(value)
}

const SVG_PRESERVED_LOWER = new Set(['d', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry'])

function svgAttrToJsx(name) {
  if (name === 'class') return 'className'
  if (name === 'for') return 'htmlFor'
  if (name === 'xmlns' || name.startsWith('xmlns:')) return name
  if (name.startsWith('xlink:')) {
    const rest = name.slice(6)
    return 'xlink' + rest[0].toUpperCase() + rest.slice(1)
  }
  if (name.startsWith('xml:')) {
    const rest = name.slice(4)
    return 'xml' + rest[0].toUpperCase() + rest.slice(1)
  }
  if (SVG_PRESERVED_LOWER.has(name)) return name
  if (name.includes('-')) return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  return name
}

function renderAttrValue(s) {
  if (typeof s !== 'string') return `{${JSON.stringify(s)}}`
  if (/^[\x20-\x7e]*$/.test(s) && !/["<>&{}\\]/.test(s)) return `"${s}"`
  return `{${JSON.stringify(s)}}`
}

// Always wrap text in a JS expression to dodge JSX whitespace stripping
// and entity decoding. Output is correct, if slightly less pretty.
function renderText(s) { return `{${JSON.stringify(s)}}` }

function renderStyle(obj) {
  const entries = Object.entries(obj)
  if (!entries.length) return null
  const parts = entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  return `style={{${parts.join(', ')}}}`
}

// -- SVG parser ---------------------------------------------------------------

function parseSvg(markup) {
  try {
    const tokens = tokenizeSvg(markup)
    const stack = [{ tag: '#root', children: [] }]
    for (const tok of tokens) {
      if (tok.type === 'open') {
        const node = { tag: tok.tag, attrs: tok.attrs, children: [] }
        stack[stack.length - 1].children.push(node)
        if (!tok.selfClosing) stack.push(node)
      } else if (tok.type === 'close') {
        if (stack.length < 2) return null
        const top = stack.pop()
        if (top.tag !== tok.tag) return null
      } else if (tok.type === 'text') {
        if (tok.value.trim().length === 0) continue
        stack[stack.length - 1].children.push({ tag: '#text', value: tok.value })
      }
    }
    if (stack.length !== 1) return null
    return stack[0].children.find((c) => c.tag === 'svg') || null
  } catch {
    return null
  }
}

function tokenizeSvg(s) {
  const tokens = []
  let i = 0
  while (i < s.length) {
    if (s[i] === '<') {
      if (s.startsWith('<!--', i)) {
        const end = s.indexOf('-->', i + 4)
        if (end < 0) throw new Error('unterminated comment')
        i = end + 3; continue
      }
      if (s.startsWith('<![', i) || s.startsWith('<!', i) || s.startsWith('<?', i)) {
        throw new Error('unsupported markup')
      }
      if (s[i + 1] === '/') {
        const end = s.indexOf('>', i)
        if (end < 0) throw new Error('unterminated tag')
        tokens.push({ type: 'close', tag: s.slice(i + 2, end).trim() })
        i = end + 1; continue
      }
      const end = findTagEnd(s, i)
      if (end < 0) throw new Error('unterminated tag')
      const inner = s.slice(i + 1, end)
      const selfClosing = inner.endsWith('/')
      const body = (selfClosing ? inner.slice(0, -1) : inner).trim()
      const { tag, attrs } = parseTagBody(body)
      tokens.push({ type: 'open', tag, attrs, selfClosing })
      i = end + 1
    } else {
      const next = s.indexOf('<', i)
      const end = next < 0 ? s.length : next
      tokens.push({ type: 'text', value: s.slice(i, end) })
      i = end
    }
  }
  return tokens
}

function findTagEnd(s, start) {
  let i = start + 1
  while (i < s.length) {
    const c = s[i]
    if (c === '"' || c === "'") {
      const end = s.indexOf(c, i + 1)
      if (end < 0) return -1
      i = end + 1; continue
    }
    if (c === '>') return i
    i++
  }
  return -1
}

function parseTagBody(body) {
  let i = 0
  while (i < body.length && !/\s/.test(body[i])) i++
  const tag = body.slice(0, i)
  const attrs = {}
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++
    if (i >= body.length) break
    let nameEnd = i
    while (nameEnd < body.length && body[nameEnd] !== '=' && !/\s/.test(body[nameEnd])) nameEnd++
    const name = body.slice(i, nameEnd)
    i = nameEnd
    if (i < body.length && body[i] === '=') {
      i++
      const quote = body[i]
      if (quote === '"' || quote === "'") {
        const end = body.indexOf(quote, i + 1)
        if (end < 0) throw new Error('unterminated attr')
        attrs[name] = decodeXmlEntities(body.slice(i + 1, end))
        i = end + 1
      } else {
        let valEnd = i
        while (valEnd < body.length && !/\s/.test(body[valEnd])) valEnd++
        attrs[name] = decodeXmlEntities(body.slice(i, valEnd))
        i = valEnd
      }
    } else {
      attrs[name] = ''
    }
  }
  return { tag, attrs }
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// Emit a parsed SVG node. `extraAttrParts` (only ever set on the root <svg>)
// carries the captured wrapper's className / style / data-anim, which need
// to merge onto the <svg> itself since we no longer wrap it in a span.
function emitSvgNode(node, indent, extraAttrParts) {
  if (node.tag === '#text') return indent + renderText(node.value)
  const baseParts = []
  for (const [name, value] of Object.entries(node.attrs)) {
    baseParts.push(`${svgAttrToJsx(name)}=${renderAttrValue(value)}`)
  }
  const parts = extraAttrParts ? mergeAttrLists(baseParts, extraAttrParts) : baseParts
  const opening = `<${node.tag}${parts.length ? ' ' + parts.join(' ') : ''}`
  if (!node.children || node.children.length === 0) return `${indent}${opening} />`
  const lines = [`${indent}${opening}>`]
  for (const c of node.children) lines.push(emitSvgNode(c, indent + '  '))
  lines.push(`${indent}</${node.tag}>`)
  return lines.join('\n')
}

function mergeAttrLists(base, extras) {
  const out = [...base]
  const findIdx = (arr, prefix) => arr.findIndex((p) => p.startsWith(prefix))
  for (const extra of extras) {
    const m = extra.match(/^([\w-]+)=/)
    if (!m) { out.push(extra); continue }
    const key = m[1]
    if (key === 'className') {
      const baseIdx = findIdx(out, 'className=')
      if (baseIdx >= 0) {
        out[baseIdx] = `className=${concatJsxStringAttrs(
          out[baseIdx].slice('className='.length),
          extra.slice('className='.length),
        )}`
        continue
      }
    }
    const dupIdx = findIdx(out, `${key}=`)
    if (dupIdx >= 0) out[dupIdx] = extra
    else out.push(extra)
  }
  return out
}

function concatJsxStringAttrs(a, b) {
  const unwrap = (s) => {
    if (s.startsWith('"') && s.endsWith('"')) return JSON.parse(s)
    if (s.startsWith('{') && s.endsWith('}')) return JSON.parse(s.slice(1, -1))
    return s
  }
  return renderAttrValue(`${unwrap(a)} ${unwrap(b)}`.trim())
}

// -- attribute collection -----------------------------------------------------

function collectAttrs(node) {
  const parts = []
  if (node.classes && node.classes.length) {
    parts.push(`className=${renderAttrValue(node.classes.join(' '))}`)
  }
  if (node.inlineStyle) {
    const parsed = parseStyleString(node.inlineStyle)
    for (const k of IX2_INJECTED_STYLE_KEYS) delete parsed[k]
    const styleStr = renderStyle(parsed)
    if (styleStr) parts.push(styleStr)
  }
  if (node.props) {
    const wid = node.props['data-w-id']
    const animEffect = wid ? animMap[wid] : undefined
    if (animEffect) parts.push(`data-anim=${renderAttrValue(animEffect)}`)
    for (const [k, v] of Object.entries(node.props)) {
      if (RESERVED_PROP_KEYS.has(k)) continue
      if (k.startsWith('data-w-')) continue
      let value = v
      if (k === 'href' || k === 'action') value = rewriteLink(value)
      const jsxName = htmlAttrToJsx(k)
      parts.push(`${jsxName}=${renderHtmlAttrValue(jsxName, value)}`)
    }
  }
  return parts
}

// -- lift refactor (Phase C) -------------------------------------------------
// Reads the optional <slug>.subcomponents.json (Phase B output) and pre-computes
// a map: nodeRef → { helperName, propsObj }. Helper component bodies are
// emitted at the top of the file. See CODEGEN.md §9.

function parseSelector(sel) {
  const steps = []
  for (const part of sel.trim().split(/\s+/)) {
    if (!part) continue
    let tag = null
    const classes = []
    let i = 0
    if (/^[a-zA-Z]/.test(part)) {
      let end = i
      while (end < part.length && /[a-zA-Z0-9]/.test(part[end])) end++
      tag = part.slice(i, end)
      i = end
    }
    while (i < part.length) {
      if (part[i] !== '.') return null // unsupported combinator/syntax
      let end = i + 1
      while (end < part.length && /[\w-]/.test(part[end])) end++
      classes.push(part.slice(i + 1, end))
      i = end
    }
    if (!tag && classes.length === 0) return null
    steps.push({ tag, classes })
  }
  return steps.length ? steps : null
}

function matchSimple(node, step) {
  if (isText(node)) return false
  if (step.tag && node.tag !== step.tag) return false
  for (const c of step.classes) {
    if (!(node.classes || []).includes(c)) return false
  }
  return true
}

// Walk `root` finding nodes that match `selector`. Skips into `stopAt(node)`
// returning true — used to mirror emit's pruning so matches don't end up in
// dead subtrees that emit never visits.
function findMatches(root, selector, stopAt) {
  const steps = parseSelector(selector)
  if (!steps) return null
  const matches = []
  function walk(node, ancestors) {
    if (!node || isText(node)) return
    if (STRIP_TAGS.has(node.tag)) return
    if (stopAt && stopAt(node)) return
    if (matchSimple(node, steps[steps.length - 1])) {
      let stepIdx = steps.length - 2
      let ai = ancestors.length - 1
      let ok = true
      while (stepIdx >= 0 && ok) {
        let found = false
        while (ai >= 0) {
          if (matchSimple(ancestors[ai], steps[stepIdx])) { found = true; ai--; break }
          ai--
        }
        if (!found) ok = false
        stepIdx--
      }
      if (ok) matches.push(node)
    }
    const childAnc = ancestors.concat([node])
    for (const c of node.children || []) walk(c, childAnc)
  }
  walk(root, [])
  return matches
}

function shapeHash(node) {
  if (isText(node)) return 'T'
  const cls = (node.classes || []).join(',')
  const kids = (node.children || []).map(shapeHash).join(';')
  return `${node.tag}|${cls}|${kids}`
}

// Walk parallel structures across all instances and collect the leaf positions
// whose values differ. Each varying position becomes a prop on the helper.
function collectVaryingPositions(instances) {
  const PROP_ATTRS = ['href', 'src', 'alt', 'title', 'aria-label']
  const positions = [] // { kind, attr?, path, values:[per-instance] }

  function walk(nodes, path) {
    if (nodes.some(isText)) {
      const values = nodes.map((n) => n.value)
      positions.push({ kind: 'text', path: path.slice(), values })
      return
    }
    for (const attr of PROP_ATTRS) {
      const values = nodes.map((n) => n.props?.[attr])
      if (values.every((v) => v !== undefined)) {
        positions.push({ kind: 'attr', attr, path: path.slice(), values })
      }
    }
    const childCount = nodes[0].children?.length || 0
    for (let i = 0; i < childCount; i++) {
      const childNodes = nodes.map((n) => n.children[i])
      path.push(i)
      walk(childNodes, path)
      path.pop()
    }
  }
  walk(instances, [])
  // Keep only positions where the values actually vary across instances.
  return positions.filter((p) => new Set(p.values).size > 1)
}

function namePropFromPosition(pos, used) {
  const base =
    pos.kind === 'attr'
      ? pos.attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      : 'text'
  let name = base
  let n = 1
  while (used.has(name)) { n++; name = `${base}${n}` }
  used.add(name)
  return name
}

function validateHelperName(raw, used) {
  let name = String(raw || '').replace(/[^a-zA-Z0-9]+/g, ' ').trim()
  if (!name) name = 'Item'
  name = name.split(/\s+/).map((p) => p[0].toUpperCase() + p.slice(1)).join('')
  if (!/^[A-Z]/.test(name)) name = 'Item' + name
  let final = name
  let n = 1
  while (used.has(final)) { n++; final = `${name}${n}` }
  used.add(final)
  return final
}

const liftLookup = new Map() // node object identity → { helperName, propValues }
const helpersToEmit = [] // { name, paramSig, body }
const usedNames = new Set()
const liftReports = []

if (subcomponents.length) {
  // Sort by path-depth via a quick BFS to give shallowest-rooted matches the
  // first claim on a node (matters when one selector's match contains another).
  const decisions = subcomponents.slice()
  // Simple ordering heuristic: shorter selectors (less specific) first.
  decisions.sort((a, b) => (a.selector || '').length - (b.selector || '').length)

  const claimed = new Set() // any node that's a descendant of an already-lifted root

  function markClaimedSubtree(node) {
    if (!node) return
    claimed.add(node)
    for (const c of node.children || []) markClaimedSubtree(c)
  }

  // Pre-compute the search root set: emit walks body's non-skipped children.
  // Lift must mirror that view — matches inside skipped subtrees would be
  // emitted as dead helper definitions (the helper invocation never lands).
  const searchRoots =
    tree.tag === 'body'
      ? (tree.children || []).filter((c) => !subtreeMatchesSkip(c) && !STRIP_TAGS.has(c.tag))
      : [tree]

  for (const decision of decisions) {
    const { selector, name } = decision
    const steps = parseSelector(selector)
    if (!steps) {
      liftReports.push(`× selector "${selector}" — invalid syntax, skipped`)
      continue
    }
    const matchesAll = []
    for (const root of searchRoots) {
      for (const m of findMatches(root, selector) || []) matchesAll.push(m)
    }
    // Drop matches whose subtrees were already claimed by an earlier (outer) lift.
    const matches = matchesAll.filter((n) => !claimed.has(n))
    if (matches.length < 2) {
      liftReports.push(`× selector "${selector}" — only ${matches.length} match, skipped`)
      continue
    }
    // Structural equivalence: all matches must share the same shape hash.
    const hashes = matches.map(shapeHash)
    if (new Set(hashes).size > 1) {
      liftReports.push(`× selector "${selector}" — ${matches.length} matches not structurally equivalent, skipped`)
      continue
    }
    // Diff to find varying positions → props.
    const varying = collectVaryingPositions(matches)
    const usedProps = new Set()
    const propNames = varying.map((p) => namePropFromPosition(p, usedProps))
    const helperName = validateHelperName(name, usedNames)

    // Build helper body. We re-emit the FIRST instance's structure but at each
    // varying position we substitute `{props.xxx}` instead of the literal.
    const overrides = new Map() // pathKey → { kind, attr?, paramName }
    varying.forEach((p, i) => {
      overrides.set(`${p.kind}:${p.path.join('/')}${p.attr ? ':' + p.attr : ''}`, {
        kind: p.kind, attr: p.attr, paramName: propNames[i],
      })
    })
    const helperBody = emitHelperTemplate(matches[0], '    ', [], overrides)
    const paramSig = propNames.length
      ? `({ ${propNames.join(', ')} }: { ${propNames.map((n) => `${n}: string`).join('; ')} })`
      : '()'
    helpersToEmit.push({ name: helperName, paramSig, body: helperBody })

    // Per-instance prop value map; at emit time, look up and emit
    // <Helper a="..." b="..." />.
    matches.forEach((node, instanceIdx) => {
      const propValues = {}
      varying.forEach((p, i) => {
        propValues[propNames[i]] = p.values[instanceIdx]
      })
      liftLookup.set(node, { helperName, propValues })
      markClaimedSubtree(node)
    })
    liftReports.push(`✓ ${helperName} — ${matches.length} instances, ${propNames.length} props`)
  }
}

// Emit the helper's JSX template using overrides at varying positions.
function emitHelperTemplate(node, indent, path, overrides) {
  if (isText(node)) {
    const key = `text:${path.join('/')}`
    const ov = overrides.get(key)
    if (ov) return `${indent}{${ov.paramName}}`
    return indent + renderText(node.value)
  }
  if (STRIP_TAGS.has(node.tag)) return null

  if (node.tag === 'svg' && node.svgMarkup) {
    const wrapperAttrParts = collectAttrs(node)
    const parsed = parseSvg(node.svgMarkup)
    if (parsed) return emitSvgNode(parsed, indent, wrapperAttrParts)
    const safeParts = wrapperAttrParts.filter((p) => {
      const m = p.match(/^([\w-]+)=/)
      if (!m) return false
      const k = m[1]
      return k === 'className' || k === 'style' ||
        k.startsWith('data-') || k.startsWith('aria-') || k === 'role'
    })
    safeParts.push(`dangerouslySetInnerHTML={{__html: ${JSON.stringify(node.svgMarkup)}}}`)
    return `${indent}<span${safeParts.length ? ' ' + safeParts.join(' ') : ''} />`
  }

  // Build attr parts but substitute overrides for known PROP_ATTRS.
  const parts = []
  if (node.classes && node.classes.length) {
    parts.push(`className=${renderAttrValue(node.classes.join(' '))}`)
  }
  if (node.inlineStyle) {
    const parsed = parseStyleString(node.inlineStyle)
    for (const k of IX2_INJECTED_STYLE_KEYS) delete parsed[k]
    const styleStr = renderStyle(parsed)
    if (styleStr) parts.push(styleStr)
  }
  if (node.props) {
    const wid = node.props['data-w-id']
    const animEffect = wid ? animMap[wid] : undefined
    if (animEffect) parts.push(`data-anim=${renderAttrValue(animEffect)}`)
    for (const [k, v] of Object.entries(node.props)) {
      if (RESERVED_PROP_KEYS.has(k)) continue
      if (k.startsWith('data-w-')) continue
      const ovKey = `attr:${path.join('/')}:${k}`
      const ov = overrides.get(ovKey)
      const jsxName = htmlAttrToJsx(k)
      if (ov) {
        parts.push(`${jsxName}={${ov.paramName}}`)
        continue
      }
      let value = v
      if (k === 'href' || k === 'action') value = rewriteLink(value)
      parts.push(`${jsxName}=${renderHtmlAttrValue(jsxName, value)}`)
    }
  }

  const tag = node.tag
  const isVoid = VOID_TAGS.has(tag)
  const childLines = []
  if (!isVoid) {
    for (let i = 0; i < (node.children || []).length; i++) {
      path.push(i)
      const out = emitHelperTemplate(node.children[i], indent + '  ', path, overrides)
      path.pop()
      if (out !== null) childLines.push(out)
    }
  }
  const opening = `<${tag}${parts.length ? ' ' + parts.join(' ') : ''}`
  if (isVoid || !childLines.length) return `${indent}${opening} />`
  return [`${indent}${opening}>`, ...childLines, `${indent}</${tag}>`].join('\n')
}

// -- main emitter -------------------------------------------------------------

function emitNode(node, indent) {
  if (isText(node)) return indent + renderText(node.value)
  if (STRIP_TAGS.has(node.tag)) return null

  // Lift hit: the agent decided this subtree should be a helper component.
  // Emit the helper reference with its props instead of walking children.
  const lifted = liftLookup.get(node)
  if (lifted) {
    const propParts = Object.entries(lifted.propValues).map(
      ([k, v]) => `${k}=${renderAttrValue(v)}`,
    )
    return `${indent}<${lifted.helperName}${propParts.length ? ' ' + propParts.join(' ') : ''} />`
  }

  if (node.tag === 'svg' && node.svgMarkup) {
    const wrapperAttrParts = collectAttrs(node)
    const parsed = parseSvg(node.svgMarkup)
    if (parsed) return emitSvgNode(parsed, indent, wrapperAttrParts)
    // Parse failed — render as a span wrapping the raw SVG markup. SVG-only
    // attrs from the captured <svg> (width, height, viewBox, fill, xmlns…)
    // do not apply to a span; keep only className/style/data-anim/data-*/aria-*.
    const safeParts = wrapperAttrParts.filter((p) => {
      const m = p.match(/^([\w-]+)=/)
      if (!m) return false
      const k = m[1]
      return k === 'className' || k === 'style' ||
        k.startsWith('data-') || k.startsWith('aria-') || k === 'role'
    })
    safeParts.push(`dangerouslySetInnerHTML={{__html: ${JSON.stringify(node.svgMarkup)}}}`)
    return `${indent}<span${safeParts.length ? ' ' + safeParts.join(' ') : ''} />`
  }

  const parts = collectAttrs(node)
  const tag = node.tag
  const isVoid = VOID_TAGS.has(tag)
  const childLines = []
  if (!isVoid) {
    for (const c of node.children || []) {
      const out = emitNode(c, indent + '  ')
      if (out !== null) childLines.push(out)
    }
  }
  const opening = `<${tag}${parts.length ? ' ' + parts.join(' ') : ''}`
  if (isVoid || !childLines.length) return `${indent}${opening} />`
  return [`${indent}${opening}>`, ...childLines, `${indent}</${tag}>`].join('\n')
}

// -- emit ---------------------------------------------------------------------

// PageRenderer's runtime skip filter ran only at body-child level: each top
// child whose subtree contains a skip signature is dropped wholesale (the
// shared component renders that subtree separately). Mirror that behavior
// here. Inside a kept body child, emitNode walks freely.
const root = tree
const bodyChildrenLines = []
const emitInto = (n) => {
  const out = emitNode(n, '      ')
  if (out !== null) bodyChildrenLines.push(out)
}
if (root.tag === 'body') {
  for (const c of root.children || []) {
    if (subtreeMatchesSkip(c)) continue
    emitInto(c)
  }
} else {
  emitInto(root)
}

const helpersBlock = helpersToEmit.map((h) =>
  `function ${h.name}${h.paramSig} {\n  return (\n${h.body}\n  )\n}\n`
).join('\n')

const fileBody = `// THIS FILE IS GENERATED. DO NOT EDIT BY HAND.
// Source: src/components/generated/${slug}.tree.json (+ animations + manifests)
// Re-run: node scripts/codegen-page.mjs ${slug}

${helpersBlock}export function ${pascalSlug}() {
  return (
    <>
${bodyChildrenLines.join('\n')}
    </>
  )
}
`

await writeFile(outPath, fileBody)
log(`✓ Wrote ${outPath}`)
log(`  Component : <${pascalSlug} />`)
log(`  Lines     : ${fileBody.split('\n').length.toLocaleString()}`)
log(`  Skip sigs : ${skipSet.size ? [...skipSet].join(', ') : '(none)'}`)
if (subcomponents.length) {
  log(`  Helpers   : ${helpersToEmit.length}/${subcomponents.length} lifted`)
  for (const r of liftReports) log(`    ${r}`)
}

// Run the data-driven verifier. Failure here means codegen has a bug —
// emitted a value that doesn't trace back to captured data. Hard fail.
const verifyScript = resolve(__dirname, 'verify-codegen.mjs')
const result = spawnSync(process.execPath, [verifyScript, slug], { stdio: 'inherit' })
if (result.status !== 0) die(`Verification failed (codegen produced untraceable values).`)
