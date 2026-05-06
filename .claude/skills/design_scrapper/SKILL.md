---
name: design_scrapper
description: >
  Extracts any live Webflow (or any website) section into a structured React
  component tree. Use this skill whenever the user wants to clone, copy,
  replicate, inspect, or convert a UI section from a live website into React
  components. Triggers include: "copy this section", "clone this element",
  "turn this into React", "extract this component from the site",
  "inspect the styles of this section", "I want to rebuild this in React",
  "scrape this UI", or any mention of a URL + a selector they want to
  convert. Always use this skill when the user provides or asks for a URL
  and a CSS selector together, even if they don't say "React" explicitly.
---

# Webflow → React Extractor

Converts any live website section into a structured, ready-to-read React
component tree — complete with computed styles, layout data, typography,
props, mixed inline text, pseudo-elements, and inline SVG markup — by
running a browser console script on the target page.

---

## How it works

The workflow has two phases:

**Phase 1 — Inspect (browser console)**
The user runs `inspect-for-react.js` in their browser DevTools console while
on the target page. The script walks the target element and all its children,
extracts computed styles and React-relevant data, and downloads a
`react-tree-[viewport]px.json` file.

**Phase 2 — Generate (Claude)**
The user pastes or uploads the JSON. Claude reads the tree and produces clean,
idiomatic React components — one per logical UI block — with inline styles,
props, and structure that matches the original 1:1.

---

## Step 1 — Ask the user for two things

Before doing anything else, ask:

1. **The URL** of the page that contains the section they want to copy.
2. **The CSS selector** of the target element (e.g. `section.section.white-brand-shapes.giftcarxd-valentine`).

If the user isn't sure about the selector, tell them to:
- Right-click the element in the browser → Inspect
- Look at the `class` attribute in the Elements panel
- Chain all classes together with dots: `section.class-one.class-two`

---

## Step 2 — Give the user the inspect script

Tell the user to:

1. Open the URL in Chrome or Firefox
2. Open DevTools (`F12` or right-click → Inspect → Console tab)
3. Paste and run the script below, **after updating `TARGET_SELECTOR`** at the top

### `inspect-for-react.js`

```javascript
(function () {

const TARGET_SELECTOR = 'PASTE_YOUR_SELECTOR_HERE';

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
];

const SKIP_VALUES = new Set([
  'none','normal','auto','0px','0','transparent',
  'rgba(0, 0, 0, 0)','initial','inherit','unset',
  'visible','static','inline','start','baseline',
  'nowrap','repeat','100%','ease','0s','medium','flat','separate','clip',
]);

const ALWAYS_INCLUDE = new Set([
  'display','position','font-family','font-size','color',
  'background-color','width','height','flex-direction',
]);

function toCamelCase(prop) {
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function isSkippable(prop, value) {
  if (ALWAYS_INCLUDE.has(prop)) return false;
  if (!value || value === '') return true;
  if (SKIP_VALUES.has(value.trim())) return true;
  if (prop === 'transform' && value === 'matrix(1, 0, 0, 1, 0, 0)') return true;
  return false;
}

function getReactTag(el) {
  const map = {
    section:'section',div:'div',a:'a',img:'img',
    h1:'h1',h2:'h2',h3:'h3',h4:'h4',
    p:'p',span:'span',ul:'ul',li:'li',
    button:'button',form:'form',input:'input',
    nav:'nav',header:'header',footer:'footer',
    main:'main',article:'article',svg:'svg',
  };
  return map[el.tagName.toLowerCase()] || el.tagName.toLowerCase();
}

function getReactProps(el) {
  const props = {};
  if (el.tagName === 'A') {
    if (el.href)   props.href   = el.href;
    if (el.target) props.target = el.target;
    if (el.rel)    props.rel    = el.rel;
  }
  if (el.tagName === 'IMG') {
    const rawSrc = el.getAttribute('src') || '';
    const isBase64 = rawSrc.startsWith('data:');
    props.src    = isBase64 ? '[base64]' : el.currentSrc || el.src;
    props.alt    = el.alt || '';
    if (isBase64) props._base64Note = 'Original src was a data: URL. Replace with the real CDN URL from the source page.';
    if (el.srcset)  props.srcSet  = el.srcset;
    if (el.sizes)   props.sizes   = el.sizes;
    if (el.loading) props.loading = el.loading;
  }
  if (el.tagName === 'INPUT') {
    if (el.type)        props.type        = el.type;
    if (el.placeholder) props.placeholder = el.placeholder;
    if (el.name)        props.name        = el.name;
  }
  const isInteractive =
    el.tagName === 'BUTTON' ||
    el.tagName === 'A' ||
    el.getAttribute('role') === 'button' ||
    el.hasAttribute('onclick');
  if (isInteractive) props['[onClick]'] = 'handler';
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-w-')) props[attr.name] = attr.value;
  }
  return props;
}

function getStyles(el, pseudo = null) {
  const computed = window.getComputedStyle(el, pseudo);
  const styles = {};
  for (const prop of PROPS_TO_EXTRACT) {
    const value = computed.getPropertyValue(prop)?.trim();
    if (!value || isSkippable(prop, value)) continue;
    styles[toCamelCase(prop)] = value;
  }
  return styles;
}

function getPseudoStyles(el) {
  const result = {};
  for (const pseudo of ['::before', '::after']) {
    const computed = window.getComputedStyle(el, pseudo);
    const content = computed.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal') continue;
    const styles = getStyles(el, pseudo);
    styles.content = content;
    result[pseudo] = styles;
  }
  return Object.keys(result).length ? result : null;
}

function getSvgMarkup(el) {
  if (el.tagName.toLowerCase() !== 'svg') return null;
  return el.outerHTML;
}

function buildChildren(el, depth) {
  const out = [];
  for (const node of el.childNodes) {
    if (node.nodeType === 1) {
      out.push(buildTree(node, depth + 1));
    } else if (node.nodeType === 3) {
      const value = node.nodeValue;
      if (value && value.trim()) {
        out.push({ type: 'text', value });
      }
    }
  }
  return out;
}

function buildTree(el, depth = 0) {
  const tag = getReactTag(el);
  const node = {
    tag,
    classes:  Array.from(el.classList),
    styles:   getStyles(el),
    props:    getReactProps(el),
    children: tag === 'svg' ? [] : buildChildren(el, depth),
    depth,
  };
  const pseudo = getPseudoStyles(el);
  if (pseudo) node.pseudo = pseudo;
  if (tag === 'svg') {
    node.svgMarkup = getSvgMarkup(el);
    node._svgNote = 'Inline this markup verbatim in the React component.';
  }
  return node;
}

const target = document.querySelector(TARGET_SELECTOR);
if (!target) return console.error('[inspect] Element not found:', TARGET_SELECTOR);

const tree = buildTree(target);
console.log('[inspect] Tree built. Downloading JSON...');
console.log(tree);

const blob = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' });
const a    = document.createElement('a');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
a.href     = URL.createObjectURL(blob);
a.download = `react-tree-${window.innerWidth}px-${stamp}.json`;
a.click();

console.log('[inspect] Done. Upload the JSON to Claude.');

})();
```

Remind the user to run it **once per breakpoint** they care about (e.g. 375px
mobile, 768px tablet, 1440px desktop) and upload all the JSON files.

---

## Step 3 — Receive the JSON and generate React components

When the user uploads the JSON file(s), Claude reads the tree and:

### Component decomposition rules

Pick component boundaries from the JSON using these heuristics, in priority order:

1. **Repeated subtrees** — if two siblings have the same `tag` + `classes`
   shape, extract a shared component and pass differing text-node values
   and `props` as React props.
2. **Semantic containers** — `<section>`, `<article>`, `<header>`, `<footer>`,
   `<nav>`, `<form>`, and any node with a `data-w-id` attribute are strong
   candidates for their own component.
3. **Interactive nodes** — any node with `props['[onClick]']`, an `<a>` with
   `href`, or a `<button>` becomes its own component so the handler/href
   surfaces as a prop.
4. **Style boundaries** — a node that introduces `display: flex|grid`,
   `position: absolute|fixed`, or its own `background-image` is usually a
   layout block worth naming.
5. **Depth cap** — never inline more than ~3 levels into a single component;
   split deeper subtrees out.

Name components after their **visual role**, not the Webflow class name
(e.g. `GiftCard`, `GiftCardTitle`, `GetYoursButton`). Don't treat
single-purpose wrapper divs as components on their own — inline them.

### Merging multiple breakpoint JSONs

If the user provides more than one `react-tree-*px.json`:

1. **Align by structure first.** Walk the trees in parallel by `tag` +
   `classes` + child index. If structure matches across breakpoints, merge
   styles per node.
2. **Diff the styles.** For each style key, if the value is identical across
   all breakpoints, keep it as a base style. If it differs, emit a media
   query (`@media (min-width: ...)`) or a `useBreakpoint`-driven branch
   keyed off the smallest viewport that introduces the change.
3. **Handle structural divergence.** If a node exists in one breakpoint but
   not another (Webflow often hides nodes via `display: none` per breakpoint
   rather than removing them), preserve the node and toggle visibility via
   a media query — don't try to conditionally render unless the structure
   genuinely differs.
4. **Pick a base.** Default to the smallest viewport as the base styles
   (mobile-first); larger breakpoints override via `min-width` media
   queries.

### Output format

For each component, output **two files** in the same directory:

1. `ComponentName.css` — a **plain global stylesheet** (NOT `.module.css`).
   Class selectors use the **exact class names captured in the JSON's
   `classes` array**, joined with `.` for compound selectors when a node has
   multiple classes (e.g. `.button.w-inline-block`).
2. `ComponentName.tsx` — `import './ComponentName.css'` and uses
   `className="real class names"` strings copied verbatim from the JSON.

**Two hard rules**:

- **Never emit `style={{...}}` props.** Inline styles are forbidden. The
  rendered DOM must contain `class="..."` attributes, not `style="..."`.
- **Never use CSS Modules** (`.module.css`). They hash class names
  (`.giftCard` → `_giftCard_hrpow_22`), which destroys the 1:1 mapping back
  to the source page. Use a plain `.css` file with the original class names.
- **Never rename a class** to a "visual role" name (`giftCard`,
  `wrapperCenter`, etc.). Use whatever is in the JSON's `classes` array
  verbatim, even if Webflow's names are ugly (`wrapper-center-section-2`,
  `ticketcard-valentine`). The point of the skill is to *clone* the source.

```tsx
// ScrappedSection.tsx
import './ScrappedSection.css'

export function ScrappedSection() {
  return (
    <section className="section white-brand-shapes giftcarxd-valentine">
      <div className="container-2">
        <div className="wrapper-center-section-2 valentine-bloomgift">
          {/* ... */}
        </div>
      </div>
    </section>
  )
}
```

```css
/* ScrappedSection.css */
.section.white-brand-shapes.giftcarxd-valentine {
  display: flex;
  background-color: rgb(242, 242, 242);
  /* ... */
}
.wrapper-center-section-2.valentine-bloomgift {
  display: flex;
  flex-direction: column;
  /* ... */
}
```

Each style object on a tree node maps to one selector built from the node's
`classes` array. Camel-cased keys from the JSON convert back to kebab-case in
CSS (`backgroundColor` → `background-color`).

### Style strategy

- **Default: plain global `.css` file** + `className="..."` with verbatim
  Webflow class names. Vite supports it natively, no extra deps, no hashing.
- If the user explicitly asks for **Tailwind**, map values to nearest Tailwind
  utilities and note any values that don't map cleanly.
- If the user explicitly asks for **CSS Modules**, **styled-components**, or
  **inline styles**, adapt accordingly — but never default to those.
- Always preserve `font-family`, `font-size`, `color`, `border-radius`,
  `box-shadow` exactly — these carry the brand.
- Drop noise from the JSON when emitting CSS: `transform-origin`,
  `transition: all`, `object-fit: fill`, `object-position: 50% 50%`,
  `flex-direction: row` on `display: block` nodes, `flex: 0 1 auto`,
  `flex-shrink: 1`, `outline: ... none ...`. These are browser defaults that
  slip past the script's always-include list and pollute the output.

### Tree fields and how to render them

| Tree field | React output |
|---|---|
| `children[i].type === 'text'` | Render `value` as a JSX text node, preserving order with element children (mixed inline content) |
| `props.href` | `href` prop on `<a>` |
| `props.src` | `src` prop on `<img>` |
| `props.srcSet` / `props.sizes` | `srcSet` / `sizes` on `<img>` |
| `props.alt` | `alt` prop on `<img>` |
| `props._base64Note` | Drop from output; flag to the user that the image src needs replacing |
| `props.[onClick]` | `onClick?: () => void` in interface |
| `props.target` | `target` on `<a>` (always pair with `rel="noopener noreferrer"` for `_blank`) |
| `pseudo['::before']` / `pseudo['::after']` | Reproduce as a positioned child `<span>` or via styled-component / CSS module pseudo selector |
| `svgMarkup` | Inline the SVG markup verbatim (don't try to reconstruct from `children`) |
| `data-w-*` attrs | Strip in the React output unless the user is replicating Webflow animations |

---

## Step 4 — Offer follow-ups

After generating components, offer:

- **Responsive version** — if only one breakpoint was provided, ask if they
  want to run the script at other sizes
- **Tailwind conversion** — offer to rewrite styles as Tailwind classes
- **TypeScript props** — offer to tighten the interface with real types
- **Storybook story** — offer to scaffold a `.stories.tsx` file

---

## Notes and known limitations

- The script uses **computed styles**, not class-based CSS — so values are
  always the final resolved values at that viewport size, never ambiguous.
- **`:hover` / `:focus` / `:active` are not captured.** The snapshot is the
  resting state only. Buttons and links will look "dead" — tell the user
  they'll need to add hover/focus styling by hand (or open DevTools' "Force
  element state" panel and re-run the script for a hover variant).
- `[base64]` in `props.src` means the image was a data URL in the DOM. The
  `_base64Note` field flags this — replace with the real CDN URL from the
  source page.
- **Cross-origin images may break when copied.** If the source site serves
  images with restrictive CORS or hotlink protection, the user should
  download them locally or proxy through their own CDN.
- **Web fonts.** `font-family` is captured as a string, but `@font-face`
  declarations are not. If the design uses a custom font, the user must
  import it separately (Google Fonts link, `@font-face`, or their design
  system's font loader).
- `querySelector` returns the **first match** only. If the selector matches
  multiple elements, refine it before running.
- `data-w-*` attributes from Webflow are captured but should generally be
  **stripped** in the React output unless the user is replicating Webflow
  animations specifically.
- The script wraps itself in an IIFE to avoid colliding with the page's
  global variables (important on Webflow sites which define globals like
  `section`, `container`, etc.).
