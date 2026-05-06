import type { CSSProperties, JSX } from 'react'

type ElementNode = {
  tag: string
  classes?: string[]
  styles?: Record<string, string>
  inlineStyle?: string // raw style attribute, verbatim from source
  props?: Record<string, string>
  children?: TreeNode[]
  pseudo?: Record<string, Record<string, string>>
  svgMarkup?: string
  _svgNote?: string
  depth?: number
}
type TextNode = { type: 'text'; value: string }
type TreeNode = ElementNode | TextNode

type AnimMap = Record<string, string>
type LinkMap = Record<string, string>

// Rewrites a captured `href` / `action` so it points at the local clone
// instead of escaping back to the live source. Conservative: leaves
// anchor-only and external links alone, only matches when the URL begins
// with a source URL listed in the linkMap.
function rewriteLink(href: string, linkMap: LinkMap): string {
  if (!href) return href
  if (href.startsWith('#')) return href
  if (linkMap[href]) return linkMap[href]
  for (const [source, local] of Object.entries(linkMap)) {
    // Match `source` exactly OR followed by a `/`, `#`, `?`. Prevents
    // partial-prefix collisions (e.g. `…/menu` matching `…/menus-archive`).
    if (
      href === source ||
      href.startsWith(source + '/') ||
      href.startsWith(source + '#') ||
      href.startsWith(source + '?')
    ) {
      return local + href.slice(source.length)
    }
  }
  return href
}

const VOID_TAGS = new Set([
  'img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'area', 'base', 'col',
  'embed', 'param', 'track', 'wbr',
])

// Tags whose content/behavior would either fail to render correctly under
// React reconciliation or trigger hydration mismatches. Strip them entirely.
const STRIP_TAGS = new Set([
  'script',   // React refuses to execute; SSR/client mismatch
  'noscript', // React doesn't render its children consistently
  'link',     // belongs in <head>, not inside body
  'meta',     // belongs in <head>
  'style',    // tree-emitted styles fight our generated page.css
])

const RESERVED_PROP_KEYS = new Set([
  '_base64Note',
  '_svgNote',
  '[onClick]',
])

function parseStyleString(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of raw.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim()
    const value = decl.slice(i + 1).trim()
    if (!prop || !value) continue
    const key = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    out[key] = value
  }
  return out
}

// Style keys that IX2 injects at runtime: opacity / transform are its
// reveal-state knobs, transform-style is set on every parent of an animated
// transform. None of these come from the source CSS — they're runtime
// artifacts captured by Playwright after IX2 had already mutated the DOM.
// Strip them from EVERY node's inline style so:
//   1. animated nodes start at the CSS-defined initial state (opacity:0)
//      instead of being pinned to a stale value (opacity:1 if IX2 had
//      already revealed them, opacity:0 if it hadn't),
//   2. non-animated descendants of animated nodes (e.g. `<div class="titulo-2"
//      style="opacity:0">` inside `.title-cta`) don't stay invisible forever
//      because IX2 set them to 0 and our runtime never flips them.
const IX2_INJECTED_STYLE_KEYS = new Set(['opacity', 'transform', 'transformStyle'])

function buildAttrs(node: ElementNode, animMap: AnimMap, linkMap?: LinkMap): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  if (node.classes && node.classes.length) {
    attrs.className = node.classes.join(' ')
  }
  const wid = node.props?.['data-w-id']
  const animEffect = wid ? animMap[wid] : undefined
  if (node.inlineStyle) {
    const parsed = parseStyleString(node.inlineStyle)
    for (const k of IX2_INJECTED_STYLE_KEYS) delete parsed[k]
    if (Object.keys(parsed).length) attrs.style = parsed
  }
  if (node.props) {
    if (animEffect) attrs['data-anim'] = animEffect
    for (const [k, v] of Object.entries(node.props)) {
      if (RESERVED_PROP_KEYS.has(k)) continue
      if (k.startsWith('data-w-')) continue
      attrs[k] = v
    }
  }
  if (linkMap) {
    if (typeof attrs.href === 'string')   attrs.href   = rewriteLink(attrs.href,   linkMap)
    if (typeof attrs.action === 'string') attrs.action = rewriteLink(attrs.action, linkMap)
  }
  return attrs
}

function isText(n: TreeNode): n is TextNode {
  return (n as TextNode).type === 'text'
}

function renderNode(node: TreeNode, key: string | number, animMap: AnimMap, linkMap?: LinkMap): JSX.Element | string | null {
  if (isText(node)) return node.value

  if (STRIP_TAGS.has(node.tag)) return null

  if (node.tag === 'svg' && node.svgMarkup) {
    const attrs = buildAttrs(node, animMap, linkMap)
    return (
      <span
        key={key}
        {...(attrs as object)}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: node.svgMarkup }}
      />
    )
  }

  const attrs = buildAttrs(node, animMap, linkMap)
  const Tag = node.tag as keyof JSX.IntrinsicElements

  if (VOID_TAGS.has(node.tag)) {
    return <Tag key={key} {...(attrs as object)} />
  }

  const children = (node.children ?? []).map((c, i) => renderNode(c, i, animMap, linkMap))
  return <Tag key={key} {...(attrs as object)}>{children}</Tag>
}

// Suppress unused import warning for CSSProperties (kept for future style fallback).
export type _UnusedCSSProperties = CSSProperties

// Walks a top-level body child looking for any descendant whose
// `classes.join(' ')` matches one of the skip signatures. Used to drop
// subtrees that have been hoisted into shared components by
// /extract_components — typically a navbar or footer wrapper at body[1] /
// body[-2]. Walks all descendants (not just immediate child) because
// Webflow often wraps the meaningful component (e.g. `.navbar.w-nav`)
// inside one or more empty-class divs.
function subtreeMatchesSkip(node: TreeNode, skip: Set<string>): boolean {
  if (!skip.size) return false
  if (isText(node)) return false
  const sig = (node.classes || []).join(' ')
  if (sig && skip.has(sig)) return true
  for (const c of node.children || []) {
    if (subtreeMatchesSkip(c, skip)) return true
  }
  return false
}

export function PageRenderer({
  tree,
  animMap,
  linkMap,
  skip,
}: {
  tree: unknown
  animMap: AnimMap
  linkMap?: LinkMap
  skip?: string[]
}) {
  const root = tree as ElementNode
  const skipSet = new Set(skip || [])
  // The captured tree's root is <body>. Next.js's layout already provides
  // <html><body>, so we render only the body's children to avoid nesting
  // <body> inside <body>. The body { ... } tag-level CSS rule still applies
  // to Next's <body> via the imported per-page CSS.
  if (root.tag === 'body') {
    const kids = (root.children ?? []).filter((c) => !subtreeMatchesSkip(c, skipSet))
    return <>{kids.map((c, i) => renderNode(c, i, animMap, linkMap))}</>
  }
  return <>{renderNode(root, 'root', animMap, linkMap)}</>
}
