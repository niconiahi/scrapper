// Runs in the page context via page.evaluate(inspectInPage, selector).
// Self-contained — no closures over outer scope, since Playwright serializes
// it via .toString() and re-evals it in the browser.
export function inspectInPage(targetSelector) {
  const PROPS_TO_EXTRACT = [
    'display','flex-direction','flex-wrap','flex','flex-grow','flex-shrink','flex-basis',
    'align-items','align-self','justify-content','justify-self','gap','row-gap','column-gap',
    'grid-template-columns','grid-template-rows','grid-column','grid-row',
    'position','top','right','bottom','left','z-index',
    'width','height','min-width','max-width','min-height','max-height',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'margin','margin-top','margin-right','margin-bottom','margin-left',
    'box-sizing','overflow','overflow-x','overflow-y',
    'border','border-top','border-right','border-bottom','border-left',
    'border-radius','border-top-left-radius','border-top-right-radius',
    'border-bottom-left-radius','border-bottom-right-radius',
    'box-shadow','outline',
    'font-family','font-size','font-weight','font-style','line-height',
    'letter-spacing','text-align','text-transform','text-decoration',
    'white-space','word-break','color',
    'background-color','background-image','background-size','background-position',
    'background-repeat','opacity','visibility','cursor',
    'transform','transform-origin','transition',
    'aspect-ratio','object-fit','object-position',
  ]
  const SKIP_VALUES = new Set([
    'none','normal','auto','0px','0','transparent',
    'rgba(0, 0, 0, 0)','initial','inherit','unset',
    'visible','static','inline','start','baseline',
    'nowrap','repeat','100%','ease','0s','medium','flat','separate','clip',
  ])
  const ALWAYS_INCLUDE = new Set([
    'display','position','font-family','font-size','color',
    'background-color','width','height','flex-direction',
  ])
  const toCamelCase = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  const isSkippable = (prop, value) => {
    if (ALWAYS_INCLUDE.has(prop)) return false
    if (!value) return true
    if (SKIP_VALUES.has(value.trim())) return true
    if (prop === 'transform' && value === 'matrix(1, 0, 0, 1, 0, 0)') return true
    return false
  }
  const TAG_MAP = {
    section:'section',div:'div',a:'a',img:'img',
    h1:'h1',h2:'h2',h3:'h3',h4:'h4',
    p:'p',span:'span',ul:'ul',li:'li',
    button:'button',form:'form',input:'input',
    nav:'nav',header:'header',footer:'footer',
    main:'main',article:'article',svg:'svg',
  }
  const getReactTag = (el) => TAG_MAP[el.tagName.toLowerCase()] || el.tagName.toLowerCase()
  // HTML attribute name → React JSX prop name. Cases where React's DOM bindings
  // require the camelCase form rather than the HTML one. Non-standard / custom
  // attributes (data-*, aria-*, anything not in this map) pass through as-is.
  const REACT_ATTR_MAP = {
    'class': 'className',
    'for': 'htmlFor',
    'tabindex': 'tabIndex',
    'readonly': 'readOnly',
    'maxlength': 'maxLength',
    'minlength': 'minLength',
    'colspan': 'colSpan',
    'rowspan': 'rowSpan',
    'autocomplete': 'autoComplete',
    'autofocus': 'autoFocus',
    'autoplay': 'autoPlay',
    'playsinline': 'playsInline',
    'crossorigin': 'crossOrigin',
    'srcset': 'srcSet',
    'usemap': 'useMap',
    'enctype': 'encType',
    'novalidate': 'noValidate',
    'formaction': 'formAction',
    'formenctype': 'formEncType',
    'formmethod': 'formMethod',
    'formnovalidate': 'formNoValidate',
    'formtarget': 'formTarget',
    'allowfullscreen': 'allowFullScreen',
    'frameborder': 'frameBorder',
    'marginheight': 'marginHeight',
    'marginwidth': 'marginWidth',
    'fetchpriority': 'fetchPriority',
    'http-equiv': 'httpEquiv',
    'accept-charset': 'acceptCharset',
    'datetime': 'dateTime',
    'contenteditable': 'contentEditable',
    'spellcheck': 'spellCheck',
    'cellpadding': 'cellPadding',
    'cellspacing': 'cellSpacing',
    'referrerpolicy': 'referrerPolicy',
    'xmlns:xlink': 'xmlnsXlink',
    'xml:lang': 'xmlLang',
    'xml:space': 'xmlSpace',
  }
  // Boolean HTML attributes — React expects a real boolean for these, not a
  // string (an empty string "" or "true" both render as `attr=""`, but the
  // semantics for things like `controls`/`muted` differ if the value isn't
  // boolean).
  const BOOLEAN_ATTRS = new Set([
    'autoplay','autofocus','async','controls','defer','disabled','hidden',
    'loop','muted','open','playsinline','readonly','required','reversed',
    'selected','checked','default','allowfullscreen','novalidate','itemscope',
  ])
  const getReactProps = (el) => {
    const props = {}
    // Capture every attribute — mirror the source verbatim. Class and style
    // are handled separately (className via classes[], style via inlineStyle).
    for (const attr of el.attributes) {
      if (attr.name === 'class' || attr.name === 'style') continue
      const reactName = REACT_ATTR_MAP[attr.name] || attr.name
      const value = BOOLEAN_ATTRS.has(attr.name) ? true : attr.value
      props[reactName] = value
    }
    // <img src="data:..."> would bloat the JSON enormously and is rarely the
    // real CDN URL — note it for the user to swap in.
    if (el.tagName === 'IMG' && typeof props.src === 'string' && props.src.startsWith('data:')) {
      props.src = el.currentSrc || el.src || '[base64]'
      props._base64Note = 'Original src was a data: URL.'
    }
    // Mark interactive elements so the generator knows to surface a handler.
    const isInteractive =
      el.tagName === 'BUTTON' ||
      el.tagName === 'A' ||
      el.getAttribute('role') === 'button' ||
      el.hasAttribute('onclick')
    if (isInteractive) props['[onClick]'] = 'handler'
    return props
  }
  const getStyles = (el, pseudo = null) => {
    const computed = window.getComputedStyle(el, pseudo)
    const styles = {}
    for (const prop of PROPS_TO_EXTRACT) {
      const value = computed.getPropertyValue(prop)?.trim()
      if (!value || isSkippable(prop, value)) continue
      styles[toCamelCase(prop)] = value
    }
    return styles
  }
  const getPseudoStyles = (el) => {
    const result = {}
    for (const pseudo of ['::before', '::after']) {
      const computed = window.getComputedStyle(el, pseudo)
      const content = computed.getPropertyValue('content')
      if (!content || content === 'none' || content === 'normal') continue
      const styles = getStyles(el, pseudo)
      styles.content = content
      result[pseudo] = styles
    }
    return Object.keys(result).length ? result : null
  }
  const buildChildren = (el, depth) => {
    const out = []
    for (const node of el.childNodes) {
      if (node.nodeType === 1) {
        out.push(buildTree(node, depth + 1))
      } else if (node.nodeType === 3) {
        const value = node.nodeValue
        if (value && value.trim()) out.push({ type: 'text', value })
      }
    }
    return out
  }
  const buildTree = (el, depth = 0) => {
    const tag = getReactTag(el)
    const styles = getStyles(el)
    const node = {
      tag,
      classes: Array.from(el.classList),
      styles,
      props: getReactProps(el),
      children: tag === 'svg' ? [] : buildChildren(el, depth),
      depth,
    }
    const rawStyle = el.getAttribute('style')
    if (rawStyle) node.inlineStyle = rawStyle
    const pseudo = getPseudoStyles(el)
    if (pseudo) node.pseudo = pseudo
    if (tag === 'svg') {
      node.svgMarkup = el.outerHTML
      node._svgNote = 'Inline this markup verbatim.'
    }
    return node
  }
  const target = document.querySelector(targetSelector)
  if (!target) return { error: `Element not found: ${targetSelector}` }
  let nodeCount = 0
  const countNodes = (n) => {
    nodeCount++
    if (n.children) for (const c of n.children) if (!c.type) countNodes(c)
  }
  const tree = buildTree(target)
  countNodes(tree)
  return { tree, viewport: window.innerWidth, nodeCount }
}

// Walks the page's stylesheets and returns the source CSS rules that
// actually apply to elements inside `targetSelector`'s subtree. Verbatim
// rule text — preserves original units (%, vh, em, calc, …) and original
// selectors. Wraps rules in their @media conditions when applicable.
//
// Why: getComputedStyle resolves things like `width: 100%` to a pixel
// value at the capture viewport, which is wrong at any other size.
// Source rules are viewport-independent.
//
// CORS-blocked stylesheets (where cssRules access throws) are silently
// skipped — those URLs are still reported via capturePageContext().
export function captureSourceRules(targetSelector) {
  // Use the document element as the matching root so html/body rules are
  // included alongside descendants. The targetSelector is informational
  // (we still extract the same tree elsewhere).
  const root = document.documentElement
  if (!root) return { error: 'documentElement not found' }
  void targetSelector

  // Collect every CSSStyleRule reachable, paired with its enclosing
  // @media condition (if any). Source order is preserved.
  const all = []
  const walk = (rules, mediaCondition) => {
    for (const rule of rules) {
      const t = rule.constructor && rule.constructor.name
      if (t === 'CSSStyleRule') {
        all.push({
          selector: rule.selectorText,
          cssText: rule.cssText, // includes selector + braces + decls
          mediaCondition,
        })
      } else if (t === 'CSSMediaRule') {
        const cond = rule.media.mediaText
        const merged = mediaCondition ? `${mediaCondition} and ${cond}` : cond
        walk(rule.cssRules, merged)
      } else if (t === 'CSSSupportsRule' || t === 'CSSContainerRule' || t === 'CSSLayerBlockRule') {
        walk(rule.cssRules, mediaCondition)
      }
      // CSSFontFaceRule, CSSImportRule, CSSKeyframesRule etc. are handled
      // by capturePageContext or the import chain itself; skip here.
    }
  }
  for (const sheet of document.styleSheets) {
    // Skip stylesheets we (or our automation) injected. Identified by a
    // dataset marker on the owning <style> node. Prevents capture loops
    // where our own injected rules end up in the generated output.
    const owner = sheet.ownerNode
    if (owner && owner.tagName === 'STYLE' && owner.dataset && owner.dataset.scrapperInjected) continue
    try {
      walk(sheet.cssRules, null)
    } catch (e) { /* CORS-blocked — skip */ }
  }

  // A rule is "applicable" if any element in the page CAN match its selector
  // — including state-dependent matches like `:hover`, `.w--open`,
  // `[aria-expanded="true"]`. Webflow dropdowns / nav components dynamically
  // add `.w--open` etc. at runtime; if we filter rules by the live DOM only,
  // every "open" / "active" / "hover" rule gets dropped because no element
  // has that state at capture time.
  //
  // Strategy: try the verbatim selector first; if it doesn't match, strip
  // known stateful tokens (pseudo-classes, Webflow `.w--*` state classes,
  // boolean ARIA attribute selectors) and re-test. If the stripped form
  // matches, keep the rule — at runtime our PageInteractive component (or
  // the user's interaction) will add those state markers and the rule will
  // kick in.
  const stripStateful = (sel) => sel
    .replace(/::?(?:hover|focus|active|focus-visible|focus-within|valid|invalid|disabled|enabled|checked|placeholder-shown|target|visited|link)\b/g, '')
    .replace(/\.w--[a-zA-Z0-9_-]+/g, '')
    .replace(/\[aria-(?:expanded|selected|current|pressed|checked|hidden)\s*=\s*"(?:true|false)"\]/g, '')
    .replace(/\[(?:open|aria-current)(?:\s*=\s*[^\]]+)?\]/g, '')
    .replace(/\[data-(?:state|open)\s*=\s*"(?:open|true|active)"\]/g, '')

  const matchesAny = (sel) => {
    try {
      if (root.matches(sel)) return true
      return !!root.querySelector(sel)
    } catch (e) { return false }
  }

  const applies = (selector) => {
    if (matchesAny(selector)) return true
    const stripped = stripStateful(selector).trim()
    if (!stripped || stripped === selector) return false
    // Selectors can be comma-separated. Match if ANY of the alternatives
    // applies in stripped form.
    for (const part of stripped.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (matchesAny(part)) return true
    }
    return false
  }

  // Also dedupe: identical (selector + media + cssText) → one entry.
  const seen = new Set()
  const out = []
  for (const r of all) {
    if (!applies(r.selector)) continue
    const key = (r.mediaCondition || '') + '|' + r.cssText
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return { rules: out, ruleCount: out.length }
}

// Captures page-level baseline: html/body computed styles, :root CSS
// variables, @font-face rules, and stylesheet <link> URLs. Runs in the page
// context via page.evaluate(capturePageContext).
export function capturePageContext() {
  const PROPS = [
    'display','box-sizing','margin','margin-top','margin-right','margin-bottom','margin-left',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'font-family','font-size','font-weight','font-style','line-height',
    'letter-spacing','text-rendering','-webkit-font-smoothing',
    'color','background-color','background-image','background-size','background-position','background-repeat',
    'min-height','height','width','overflow','overflow-x','overflow-y',
    'scroll-behavior','-webkit-text-size-adjust',
  ]
  const captureStyles = (el) => {
    const computed = window.getComputedStyle(el)
    const out = {}
    for (const prop of PROPS) {
      const value = computed.getPropertyValue(prop)?.trim()
      if (value) out[prop] = value
    }
    return out
  }

  // CSS custom properties on :root
  const rootStyle = window.getComputedStyle(document.documentElement)
  const cssVars = {}
  for (let i = 0; i < rootStyle.length; i++) {
    const name = rootStyle[i]
    if (name.startsWith('--')) {
      cssVars[name] = rootStyle.getPropertyValue(name).trim()
    }
  }

  // @font-face rules (best-effort — cross-origin sheets throw)
  const fontFaces = []
  const corsBlocked = []
  for (const sheet of document.styleSheets) {
    try {
      const rules = sheet.cssRules || []
      for (const rule of rules) {
        // CSSFontFaceRule.type === 5 (older) or constructor name check (newer)
        if (rule.type === 5 || (rule.constructor && rule.constructor.name === 'CSSFontFaceRule')) {
          fontFaces.push(rule.cssText)
        }
      }
    } catch (e) {
      if (sheet.href) corsBlocked.push(sheet.href)
    }
  }

  // <link rel="stylesheet"> URLs (fallback so user can import them directly)
  const stylesheetUrls = []
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    if (link.href) stylesheetUrls.push(link.href)
  }

  return {
    title: document.title,
    lang: document.documentElement.lang || null,
    html: captureStyles(document.documentElement),
    body: captureStyles(document.body),
    cssVars,
    fontFaces,
    stylesheetUrls,
    corsBlocked,
  }
}
