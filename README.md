# scrapper

Clones any live (Webflow-built) website into a Next.js app, with 1:1 visual fidelity. Every cloned page is exposed at the **same path as the source URL** — `https://www.bloomroomsocial.com/menu` becomes `http://localhost:3000/menu`. Animations, fonts, breakpoints, inline SVGs, slider/dropdown/tab runtimes, and cross-page navigation are all preserved.

The codebase is built around one principle: **mirror what the original is, don't invent defaults.** The extract step is a verbatim observation of the live site (DOM, computed styles, source CSS rules, IX2 animation timeline). The build step is a deterministic transformation of that observation into React-renderable assets. The runtime is three small client wrappers (`PageRenderer`, `PageReveal`, `PageInteractive`) that turn the captured JSON into JSX and re-implement just enough of Webflow's `webflow.js` runtime (dropdowns, tabs, scroll-reveal, current-link state) to make the clone behave like the original.

---

## 1. Pipeline overview

The full lifecycle of cloning one page is **four phases**:

```
┌────────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  extract   │ → │   build  │ → │   wire   │ → │   skills │ (optional refinements)
└────────────┘   └──────────┘   └──────────┘   └──────────┘

extract:page <url> --name=<slug>
extract:ix2  <url> --name=<slug>
                                     │
                                     ▼
                       scrapped/<slug>-react-page-…json
                       scrapped/<slug>-ix2-…json

build:page-css --name=<slug>
build:ix2      --name=<slug>
                                     │
                                     ▼
                       src/components/generated/<slug>.css
                       src/components/generated/<slug>.tree.json
                       src/components/generated/<slug>.animations.css
                       src/components/generated/<slug>.animations.json
                       src/components/generated/<slug>.stylesheets.json

wire:route <url>
                                     │
                                     ▼
                       src/app/<path>/page.tsx

(optional)
  /connect_pages <route1> <route2>      → installs linkMap, audits cross-page links
  /extract_components <route1> <route2> → dedupes shared sections into src/components/shared/
  /design_scrapper <url> <selector>     → one-off section → component
```

The `--name=<slug>` flag scopes phases 1 and 2 per page. Default slug is `page` (the home). Phase 3 (`wire:route`) derives the route path from the source URL automatically.

---

## 2. Quick start (clone one page)

```bash
# 1. Install
npm install
npx playwright install chromium

# 2. Clone the home page (default --name=page)
URL=https://www.bloomroomsocial.com/
npm run extract:page    -- $URL --viewport=375
npm run extract:ix2     -- $URL
npm run build:page-css
npm run build:ix2
npm run wire:route      -- $URL --path=/ --force   # / collides with Next.js default home

# 3. Clone the menu page (--name=menu scopes the artifacts)
URL=https://www.bloomroomsocial.com/menu
npm run extract:page    -- $URL --viewport=375 --name=menu
npm run extract:ix2     -- $URL --name=menu
npm run build:page-css  -- --name=menu
npm run build:ix2       -- --name=menu
npm run wire:route      -- $URL                    # creates src/app/menu/page.tsx

# 4. Connect them (rewrites cross-page links to local routes, audits)
npm run dev
# In Claude:  /connect_pages /  /menu

# 5. (Optional) Dedupe shared header/footer
# In Claude:  /extract_components / /menu
```

`http://localhost:3000/` mirrors the live home, `http://localhost:3000/menu` mirrors the live menu, and the Home / Menu nav links resolve locally between the two.

---

## 3. Architecture mental model

A cloned page is reconstructed from three independent inputs:

| Input | What it is | Captured by | Owns |
|---|---|---|---|
| **Tree JSON** | The DOM structure (tag, classes, attrs, text, inline styles, SVG markup) | `extract:page` | What renders |
| **CSS** | The actual stylesheets the live page used (verbatim, with `@media` wrappers) | `extract:page` | How it looks |
| **Animations JSON** | A `data-w-id → preset` map for IX2 reveals | `extract:ix2` | When elements fade in |

These three inputs feed three runtime components:

| Component | Responsibility |
|---|---|
| **`PageRenderer`** | Walks the tree JSON and emits JSX. Strips runtime artifacts (IX2-injected `opacity:0` / `transform`, etc.). Looks up the animation preset on each `data-w-id` element and adds `data-anim="…"`. Rewrites `<a href>` and `<form action>` via `linkMap`. Skips subtrees claimed by shared components via `skip`. |
| **`PageReveal`** | A client wrapper. Mounts an `IntersectionObserver` that adds `is-visible` to every `[data-anim]` element when it enters the viewport. The animation CSS reacts to that class. |
| **`PageInteractive`** | A client wrapper. Iterates a plugin registry: each plugin reimplements one Webflow component (dropdown, tabs, current-link, …) by attaching listeners to matching DOM elements and toggling state classes. |

The route file (`src/app/<path>/page.tsx`, generated by `wire:route`) is tiny — it imports the per-page assets and renders:

```tsx
<PageReveal>
  <PageInteractive />
  <Header />                                                {/* shared, optional */}
  <PageRenderer tree={tree} animMap={animMap} linkMap={linkMap} skip={SHARED_SKIP} />
  <Footer />                                                {/* shared, optional */}
  <STWrapper />                                             {/* shared, optional */}
</PageReveal>
```

That's the entire runtime. The intelligence is in the inputs (`tree`, `animMap`, `linkMap`, `skip`) and the plugins.

---

## 4. Scripts

All scripts live in `scripts/` and are exposed via `npm run …` aliases. Each prints timestamped logs.

### `npm run extract:page -- <url> [flags]`

Headless Chromium loads the URL, walks the entire `<body>` DOM tree, captures everything per viewport.

For each node it records: `tag`, `classes[]`, `props{}` (every HTML attribute, mapped to React names like `class→className`, `autoplay→autoPlay`, `playsinline→playsInline`), `styles{}` (computed CSS, filtered + browser-defaults stripped), `inlineStyle` (the raw `style="…"` attribute, verbatim), `pseudo{}` (`::before`/`::after` styles when `content` is non-empty), `svgMarkup` (`outerHTML` for `<svg>` nodes).

Alongside the tree it captures:
- **`sourceRules`** — the actual CSS rules from `document.styleSheets` that match any element in the tree. Verbatim. Preserves `%`, `vh`, `calc`, original selectors, `@media` wrappers. The `applies()` check also keeps rules whose selector matches once **stateful tokens** (`:hover`, `:focus`, `.w--open`, `.w--current`, `[aria-expanded="true"]`, `[data-state="open"]`, etc.) are stripped — so dropdown-open / hover / current-link CSS gets captured even when no element has that state at capture time.
- **`context`** — `<html>` / `<body>` computed styles, `:root` CSS variables, `@font-face` rules, stylesheet `<link>` URLs, list of CORS-blocked sheets.

CORS-blocked stylesheets (Google Fonts) are fetched server-side via Node `fetch` so their `@font-face` rules end up in the capture.

**Flags:**

| Flag | Default | Meaning |
|---|---|---|
| `--viewport=N` | `1440` | Capture at this viewport width. Repeatable. |
| `--height=N` | viewport-keyed | Override height for ALL viewports. |
| `--heights=375:667,768:1024,…` | per-viewport | Per-viewport height overrides. |
| `--name=<slug>` | none | Scope output filename. `<slug>-react-page-…`. Default produces `react-page-…` (back-compat). |
| `--out=path.json` | timestamped | Explicit output path. |
| `--wait=load\|domcontentloaded\|networkidle` | `load` | Playwright wait strategy. `networkidle` is flaky on Webflow. |
| `--settle=3000` | 3000ms | Pause after navigation (Webflow runtime needs time to init IX2). |
| `--timeout=60000` | 60000ms | Navigation timeout. |
| `--debug` | off | Verbose page console relay. |

**Output shape:**
- Single viewport → `{ tree, context, viewport, sourceRules }`
- Multiple → `{ multi: true, captures: [{ viewport, height, tree, context, sourceRules }, …] }`

**Why height matters:** `position: fixed; bottom: 60px` resolves correctly only if the viewport height matches design intent. Defaults track common device sizes (375×667, 768×1024, 1280×800).

### `npm run extract:ix2 -- <url> [flags]`

Captures Webflow's IX2 (Interactions 2.0) animation timeline.

The script reads `window.Webflow.require('ix2').store.getState().ixData` for canonical event/action-list data, then **observes the live DOM** for elements that IX2 set to a pre-reveal state (`opacity:0`, `transform: scale(0.75)`, `transform: translate3d(0, 100%)`).

Both views are merged because:
- IX2 events sometimes target design-time IDs in the form `fileId|innerId` (elements inside Webflow Symbols / Components). The runtime resolves these via internal mappings; the inner ID does NOT appear verbatim as `data-w-id` in the rendered HTML, so static parsing alone misses them.
- IX2 events with raw-UUID targets (no `|`) DO match `data-w-id` directly. These are essential for elements at the top of the page that IX2 has already revealed (opacity:1) by the 3s settle — runtime scan would skip them, but the static map still catches them.

The merged map is embedded as `_runtimeMap` inside the output JSON. Three presets are recognized: `growIn`, `fadeIn`, `slideInBottom`.

**Flags:** `--name=<slug>`, `--out=path.json`, `--timeout=60000`.

### `npm run build:page-css [-- path/to/json] [--name=<slug>]`

Reads `scrapped/<slug>-react-page-*.json` (latest, or explicit path) and emits:

- **`src/components/generated/<slug>.css`** — captured `sourceRules` verbatim, grouped by `@media` condition. **Media queries are sorted** for cascade correctness:
  - `max-width` queries: descending (largest first → smallest last → narrowest viewport wins).
  - `min-width` queries: ascending.
  - This fixes a class of bugs where `@media (max-width: 479px)` rules were being overridden by later `@media (max-width: 767px)` rules at 375px viewport.
- **`src/components/generated/<slug>.tree.json`** — the renderer's input tree (smallest viewport's tree on multi-capture; inline-style divergence across breakpoints is logged).
- **`src/components/generated/<slug>.stylesheets.json`** — original `<link rel="stylesheet">` URLs (informational).

`@font-face` for families served by Fontsource (`Arima`, `DM Sans`, `Open Sans`) are dropped to avoid double-loading. `:root` custom properties are emitted up front.

`<slug>` defaults to `page` when `--name` is omitted.

### `npm run build:ix2 [-- path/to/json] [--name=<slug>]`

Reads `scrapped/<slug>-ix2-*.json` (latest, or explicit path) and emits:

- **`src/components/generated/<slug>.animations.css`** — three CSS rule pairs (one per supported preset). Each preset has an initial state (`opacity:0`, `transform: scale(0.75)`, …) and a `.is-visible` final state with the IX2-derived `transition` (duration / easing / delay pulled from the action list). Honors `prefers-reduced-motion: reduce`.
- **`src/components/generated/<slug>.animations.json`** — `data-w-id → preset-name` map.

Webflow easing strings (`outQuart`, `inOutCubic`) are mapped to CSS `cubic-bezier(…)`. Float noise is rounded to 3 decimals.

### `npm run wire:route -- <url> [flags]`

Generates a Next.js route file mirroring the source URL.

- Parses URL → derives pathname → maps to `src/app/<path>/page.tsx`.
  - `https://…/menu` → `src/app/menu/page.tsx`
  - `https://…/about/team` → `src/app/about/team/page.tsx`
  - `https://…/` → `src/app/page.tsx` (overwrites Next.js default; needs `--force`)
- Defaults `--name=<slug>` to the last URL path segment (or `page` for `/`).
- Verifies the four required generated files exist (`<slug>.css`, `<slug>.tree.json`, `<slug>.animations.css`, `<slug>.animations.json`).
- Writes a route file that imports `linkMap` from `routes.manifest.json` and renders `<PageReveal><PageInteractive /><PageRenderer tree linkMap … /></PageReveal>`.
- Refuses to overwrite without `--force`.

**Flags:** `--name=<slug>`, `--path=/foo`, `--force`.

### `npm run detect:breakpoints -- <url>`

Walks the page's stylesheets and reports every `min-width` / `max-width` threshold. Useful for picking `--viewport` values for multi-breakpoint capture.

### `npm run extract -- <url> <selector>` (legacy)

Single-section variant of `extract:page`. Used by the `design_scrapper` skill for one-off "copy this UI block" workflows. For full-page cloning use `extract:page`.

### `scripts/screenshot.mjs` / `scripts/screenshot-multi.mjs`

Full-page Playwright screenshots. Used by `/extract_components` for visual comparison and by anyone who wants a side-by-side diff.

---

## 5. Generated assets

Live in `src/components/generated/`. Per-page filenames follow `<slug>.{ext}`.

| File | Producer | Consumer | What's in it |
|---|---|---|---|
| `<slug>.css` | `build:page-css` | route file (CSS import) | The live site's CSS rules verbatim, grouped + sorted by `@media`. Includes `@font-face` rules from CORS-blocked sheets. |
| `<slug>.tree.json` | `build:page-css` | route file (passed as `tree` prop) | The captured DOM tree (smallest viewport when multi-capture). |
| `<slug>.stylesheets.json` | `build:page-css` | (informational) | List of `<link rel="stylesheet">` URLs from the source. |
| `<slug>.animations.css` | `build:ix2` | route file (CSS import) | Three IX2 preset rule pairs (`growIn`, `fadeIn`, `slideInBottom`). |
| `<slug>.animations.json` | `build:ix2` | route file (passed as `animMap` prop) | `data-w-id → preset-name`. |

Everything in `generated/` is committed. The build is fast but Next.js needs the JSON at compile time, so importing from `scrapped/` would put raw artifacts in the bundle.

---

## 6. Runtime components

### `src/components/generated/PageRenderer.tsx`

Server-renderable. Takes four props:

```tsx
<PageRenderer
  tree={tree}                                     // captured DOM
  animMap={animMap as Record<string, string>}     // data-w-id → preset
  linkMap={linkMap}                               // sourceUrl → localPath (optional)
  skip={['navbar w-nav', 'footer-divisor']}       // class signatures to skip (optional)
/>
```

For each tree node:
- `node.classes` → `className` (verbatim; never renamed).
- `node.props` → spread, except `data-w-*` (used for animation lookup, then stripped) and reserved keys (`_base64Note`, `_svgNote`, `[onClick]`).
- `node.inlineStyle` → `style={…}` after parsing, **with `opacity` / `transform` / `transform-style` always stripped** (those are runtime artifacts left by IX2 in the DOM at capture time, not source declarations). Stripping these lets the animation CSS own reveal state and prevents non-animated descendants from being pinned invisible.
- SVG nodes → `<span dangerouslySetInnerHTML={{ __html: svgMarkup }} />`.
- `<script>`, `<noscript>`, `<link>`, `<meta>`, `<style>` tags → omitted (incompatible with React reconciliation or duplicate the head).
- If `node.props['data-w-id']` is in `animMap`, set `data-anim="<preset>"`.
- If `linkMap` is provided, rewrite `href` and `action` via `rewriteLink` (matches exact + prefix; preserves query / hash; leaves anchor / external links alone).
- The `skip` prop accepts a list of class signatures. For each top-level body child, the renderer walks the subtree and skips the entire child if any descendant's `classes.join(' ')` matches a skip entry. Used by `extract_components`-extracted components.

### `src/components/PageReveal.tsx`

`'use client'`. Mounts an `IntersectionObserver` over `[data-anim]` elements; adds `is-visible` on intersection, calls `io.unobserve(el)` (one-shot reveal).

Uses **double `requestAnimationFrame`** before observing. Without that, the observer fires synchronously on `observe()` for elements already in the viewport — initial CSS state (`opacity:0`) and `.is-visible` would land in the same paint, transition would skip. Two frames guarantee separate paints.

### `src/components/PageInteractive.tsx`

`'use client'`. A 4-line plugin runner:

```tsx
useEffect(() => {
  const cleanups = PLUGINS.map((p) => p.init(document))
  return () => cleanups.forEach((fn) => fn())
}, [])
```

Each plugin reimplements one Webflow component runtime. See section 7.

### `src/components/shared/`

Components extracted by `/extract_components`. These are static React components reused across multiple cloned routes (typically `Header`, `Footer`, `STWrapper`). The route file renders them alongside `<PageRenderer />` and the `skip` prop tells the renderer not to render the corresponding subtrees.

Page-dependent state (`.w--current` on the active nav link, `aria-current="page"`) is intentionally NOT baked into these static components. The `currentLink` plugin applies it at runtime based on `window.location.pathname`.

### `src/components/routes.manifest.json`

The link map: `{ sourceUrl: localPath }`. Auto-derived by `/connect_pages` from the `// Mirrors <url> → <path>` comments in route files. Imported by route files and passed to `PageRenderer` as the `linkMap` prop.

---

## 7. The interactive plugin system

`src/components/interactive/` is the home of Webflow-component runtime reimplementations. Each plugin is independent.

```
src/components/interactive/
├── types.ts          # type Plugin = { name; init: (root) => cleanup }
├── index.ts          # PLUGINS array — registry
├── dropdown.ts       # w-dropdown — hover/click menu
├── tabs.ts           # w-tabs — tab switcher
└── currentLink.ts    # .w--current on active nav link based on pathname
```

### Plugin shape

```ts
export type Plugin = {
  name: string
  init: (root: ParentNode) => () => void   // returns cleanup
}
```

A plugin queries the DOM under `root`, attaches event listeners / mutates state classes, and returns a cleanup function called on unmount.

### Adding a plugin

1. Create `src/components/interactive/<name>.ts` exporting `<name>Plugin: Plugin`.
2. Add it to the `PLUGINS` array in `index.ts`.
3. Done. The plugin runs on every cloned route automatically.

### Existing plugins

- **`dropdown`** — `.w-dropdown[data-hover="true"]`. Hover with `data-delay`, click toggle, keyboard (Enter/Space/Escape), outside-click close. Strips Webflow's runtime `style="height: 0px"` on init so the list can size to its contents when opened.
- **`tabs`** — `.w-tabs` / `.w-tab-link` / `.w-tab-pane`. Click + keyboard (ArrowLeft/Right, Enter/Space) navigation. Match by `aria-controls` (preferred) or `data-w-tab` → pane `id` / `data-target`. Toggles `.w--current` on link, `.w--tab-active` on pane.
- **`currentLink`** — Sets `.w--current` + `aria-current="page"` on `<a>` tags whose `href` matches the current pathname. Selector limited to known nav-link classes (`.item-header`, `.secondary-nav-item`, `.footer-link`, `.brand`, `.link-block-3`).

### Plugins not yet implemented

`w-nav` (mobile hamburger), `w-form` (intercept submit + show success block), `w-slider` (manual + arrow nav), `w-lightbox`, `w-background-video` (intersection-driven play/pause), and the IX2 hover/click action-list interpreter. See "Not yet handled" in the gotchas section.

---

## 8. Skills

Skills live in `.claude/skills/` and are invoked via `/<skill_name>` slash commands or by the user describing the intent. Each has a thorough `SKILL.md` with phases, edge cases, idempotency guarantees, and failure modes.

### `/design_scrapper <url> <selector>`

**Direction: live website → React component (one-off section).**

Generates a browser console script the user pastes into DevTools. The script extracts a tree of computed styles + props for the selector and downloads a JSON. Claude reads the JSON and emits a global `.css` file + a `.tsx` component using verbatim Webflow class names.

Use when: the user wants to copy a single section from a live site, not clone the entire site.

### `/extract_components <route1> <route2> [...]`

**Direction: cloned routes → shared component.**

Compares full-page screenshots of two or more cloned routes, identifies visual sections that appear identical across them, verifies structural identity (same tag tree, same classes, same text, same props — modulo `data-w-id` and runtime state markers `.w--current` / `aria-current`), and dedupes them into a shared static React component.

The captured tree JSONs are **left intact** — dedup happens entirely in the route-file orchestration layer. Each route file:
1. Imports the shared component.
2. Renders it alongside `<PageRenderer />`.
3. Passes a `skip={['<class-signature>', …]}` prop that tells `PageRenderer` to omit the matching subtree from the captured tree.

Page-dependent state (active nav link) is moved to the `currentLink` plugin so static shared components don't bake in per-page state.

Outputs: `src/components/shared/<Name>.tsx` files and `src/components/shared/manifest.json` (the extraction registry — class signature, hash, source routes, skip key).

Idempotent: re-runs detect existing extractions via the manifest hash and skip regeneration; route files that have lost their imports get re-patched.

### `/connect_pages [route1] [route2] [...]`

**Direction: cloned routes → cross-page navigation.**

Auto-discovers wired routes by scanning `src/app/**/page.tsx` for the `// Mirrors <url> → <path>` comment that `wire:route` writes. Bootstraps:
1. **`src/components/routes.manifest.json`** — `{ sourceUrl: localPath }` map, sorted alphabetically.
2. **`linkMap` prop on `PageRenderer`** + `rewriteLink` helper — rewrites `<a href>` / `<form action>` at render time. Conservative: matches exact source URL, OR prefix followed by `/` / `#` / `?` (preserves query / hash). Anchor-only links and same-origin relative links pass through.
3. Updates the `wire:route` template so future routes import `linkMap` automatically.
4. Retrofits existing route files (idempotent — detects already-imported manifest).

Then audits every captured `<a href>` / `<form action>` across the route trees and classifies each:
- **wired-relative / wired-absolute** — resolves locally.
- **orphan-relative / orphan-absolute** — points at a path/URL whose host matches the source domain but isn't yet cloned. Will leave the local site on click. The audit lists these so the user knows what to clone next.
- **external** — different domain, kept as-is.
- **anchor / mailto / tel** — no-op.

Output is a structured per-route report ending with explicit `npm run extract:page … && wire:route … && /connect_pages` commands for each orphan path.

---

## 9. Workflows

### A. Clone an entire site (multi-page)

```bash
for path in / /menu /about /book; do
  URL=https://www.bloomroomsocial.com$path
  NAME=$([ "$path" = "/" ] && echo "page" || echo "${path#/}")
  npm run extract:page    -- $URL --viewport=375 --name=$NAME
  npm run extract:ix2     -- $URL --name=$NAME
  npm run build:page-css  -- --name=$NAME
  npm run build:ix2       -- --name=$NAME
  if [ "$path" = "/" ]; then
    npm run wire:route -- $URL --path=/ --force
  else
    npm run wire:route -- $URL
  fi
done

# Then in Claude:
# /connect_pages
# /extract_components / /menu /about /book
```

### B. Multi-breakpoint capture for one page

```bash
npm run extract:page -- $URL \
  --viewport=375 --viewport=768 --viewport=1280 \
  --heights=375:667,768:1024,1280:800 \
  --name=$NAME
npm run extract:ix2     -- $URL --name=$NAME
npm run build:page-css  -- --name=$NAME
npm run build:ix2       -- --name=$NAME
npm run wire:route      -- $URL                    # only needed once
```

The build interleaves source rules from every capture and dedupes by `(@media, cssText)`. The renderer uses the smallest viewport's tree as the structural baseline (mobile-first).

### C. Update only the IX2 animations on an existing page

`extract:ix2` + `build:ix2` is enough; the tree stays valid as long as `data-w-id` values haven't changed. Route doesn't need re-wiring.

### D. Update only the page DOM on an existing page

`extract:page` + `build:page-css`. If `/extract_components` or `/connect_pages` had been run, no infrastructure changes — the `skip` / `linkMap` props in the route file still apply because the manifest persists. Re-run `/connect_pages` if the new tree introduces orphans.

### E. Add a new page after the others are connected

`extract:page → extract:ix2 → build:page-css → build:ix2 → wire:route`. Then `/connect_pages` (refreshes the manifest, retrofits the new route file, audits). Then optionally `/extract_components` (detects which existing shared components apply via class signature, updates only the new route file's `skip` prop and imports).

---

## 10. Conventions and design choices

- **Mirror, don't synthesize.** Source CSS rules are emitted verbatim (units, selectors, `@media` wrappers preserved) instead of being rebuilt from computed styles. Computed styles resolve `%` / `vh` / `calc(...)` to pixels at the capture viewport — wrong at any other size.
- **Class names stay verbatim.** Webflow's `wrapper-center-section-2.valentine-bloomgift` is preserved exactly. Never renamed; never hashed (no CSS Modules).
- **No inline styles in generated React.** `style={{…}}` is used only when the source HTML literally had `style="…"` AND the values aren't IX2 runtime artifacts. The DOM mirrors `class="…"`.
- **Route paths mirror source URLs.** `/menu` → `/menu`, `/about/team` → `/about/team`. Enforced by `wire:route`. Manual edits are detected (the `// Mirrors` comment marker).
- **One renderer, many pages.** `PageRenderer` is shared across all routes; per-page state lives entirely in the imported `<slug>.*` files. Adding a page is `extract → build → wire`; never copy-paste.
- **Animations are native CSS.** A 70-line `useEffect` + IntersectionObserver + plain CSS transitions covers the IX2 reveal pattern. No GSAP, no Framer Motion. (For full IX2 hover / click coverage, GSAP is the planned next step — see "Not yet handled.")
- **Webflow-component runtimes are plugins.** Each is independent, queries the document, returns a cleanup. Adding a new component category is a new plugin file, not a new code path through `PageInteractive`.
- **Extraction is observation, build is transformation.** Build is deterministic — same JSON in, same files out. Extract isn't (live target moves: republish, A/B variants, font load timing, IX2 timing). Committing `scrapped/` firewalls deterministic builds from non-deterministic captures.
- **`scrapped/` is gitignored by default.** It's regenerable from a re-extract. If reproducibility matters (you want CI rebuilds without re-hitting the live site, or you want capture regressions to surface as PR diffs), un-ignore it — the design intent supports that, the file sizes are workable (~1.5MB per 375px capture).
- **`src/components/generated/` IS committed.** Next.js needs the JSON at compile time; importing from `scrapped/` would put raw artifacts in the bundle. This is the firewall between non-deterministic capture and deterministic build/render.
- **`screenshots/` is gitignored.** Visual diff artifacts only.

---

## 11. Gotchas

### What works (verified)

- Multi-page cloning at `/`, `/menu`, etc.
- IX2 scroll-into-view reveals (3 stock presets), runtime DOM observation hybrid, double-rAF for already-visible elements.
- Verbatim source CSS, media-query cascade ordering (`max-width` desc, `min-width` asc).
- State-conditional CSS captured via stateful-token stripping (`.w--open`, `:hover`, `[aria-expanded="true"]`).
- `w-dropdown` hover/click/keyboard.
- `w-tabs` switching with keyboard arrows.
- Active-link `.w--current` per pathname.
- Per-page asset isolation via `--name`.
- URL → route mirroring via `wire:route`.
- Cross-page link rewriting via `linkMap` runtime helper.
- Shared component dedup with `skip` prop, manifest-driven, idempotent.

### Known limitations / not yet handled

- **`w-slider`.** First slide visible, rest clipped by mask. No autoplay / infinite / swipe. Plan: minimal plugin (arrows + dots + click nav) as a future plugin.
- **`w-nav` mobile hamburger.** Same shape as dropdown. Plan: extend `currentLink` or add a `nav` plugin.
- **`w-form`.** Submits POST to a Webflow endpoint that 404s locally. Plan: intercept submit, show captured `.w-form-done` block.
- **`w-lightbox`** — image gallery overlays. Not implemented.
- **`w-background-video`.** Markup correct, autoplay works, but no intersection-driven play/pause.
- **IX2 hover / click / dropdown effects (~25% of events on a typical Webflow page).** Only `SCROLL_INTO_VIEW` events with `growIn` / `fadeIn` / `slideInBottom` are handled today. Custom action lists trigger a warning and are skipped. Plan: replace `build:ix2` with a transpiler that emits GSAP timeline factories.
- **Cross-origin image hotlinking.** If the source CDN blocks hotlinking, captured `<img src="…cdn.prod.website-files.com…">` will 404 on the cloned page. Re-host or proxy via your own CDN.

### Operational quirks

- **Wiring `/` requires `--force`.** It overwrites Next.js's default `app/page.tsx`.
- **Captured `style="opacity:0"` on dropdown lists.** Webflow's runtime sets it. The dropdown plugin removes it on init.
- **Dynamic Cloudflare Turnstile widget IDs.** The form input `id` differs per page load. Treated as benign — Turnstile's runtime would replace it anyway.
- **Source page re-publishes.** Re-running `extract:page` may produce different output (DOM tweaks, new content). The build is deterministic per JSON, so re-running build / wire doesn't lose anything; `scrapped/` diffs surface regressions.

---

## 12. Project layout

```
.
├── README.md                         # this file
│
├── scripts/
│   ├── extract-page.mjs              # full-page DOM + CSS + IX2 capture per viewport (--name=<slug>)
│   ├── extract-ix2.mjs               # IX2 timeline + runtime DOM observation (--name=<slug>)
│   ├── inspect-in-page.mjs           # browser-side helpers (inspectInPage, captureSourceRules, capturePageContext)
│   ├── detect-breakpoints.mjs        # report min-/max-width thresholds in source CSS
│   ├── build-page-css.mjs            # react-page JSON → <slug>.css + <slug>.tree.json + <slug>.stylesheets.json
│   ├── build-ix2-runtime.mjs         # ix2 JSON → <slug>.animations.css + <slug>.animations.json
│   ├── wire-route.mjs                # URL → src/app/<path>/page.tsx (mirrors source pathname)
│   ├── screenshot.mjs                # full-page Playwright screenshot
│   ├── screenshot-multi.mjs          # multi-URL full-page screenshots (used by /extract_components)
│   ├── extract.mjs                   # legacy: single-section capture (used by /design_scrapper)
│   └── extract_data_for_react.js     # browser-paste version (manual run in DevTools)
│
├── scrapped/                         # raw captures (committed)
│   ├── react-page-<viewport>px-<ts>.json     # default home (--name=page implicit)
│   ├── ix2-<ts>.json                         # default home IX2
│   ├── <slug>-react-page-<viewport>px-<ts>.json   # named pages
│   └── <slug>-ix2-<ts>.json                       # named pages IX2
│
├── screenshots/                      # gitignored — visual diffs from /extract_components etc.
│   ├── ec-root-375px.png
│   └── ec-menu-375px.png
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Fontsource imports + globals
│   │   ├── globals.css
│   │   ├── page.tsx                  # / (mirrors source /, name=page)
│   │   └── menu/page.tsx             # /menu (mirrors source /menu, name=menu)
│   │
│   ├── components/
│   │   ├── PageReveal.tsx            # 'use client' IntersectionObserver wrapper
│   │   ├── PageInteractive.tsx       # 'use client' plugin runner
│   │   ├── routes.manifest.json      # { sourceUrl: localPath } — managed by /connect_pages
│   │   │
│   │   ├── generated/                # build output (committed)
│   │   │   ├── PageRenderer.tsx      # tree + animMap + linkMap + skip → JSX
│   │   │   ├── page.css              # default home assets (name=page)
│   │   │   ├── page.tree.json
│   │   │   ├── page.animations.css
│   │   │   ├── page.animations.json
│   │   │   ├── page.stylesheets.json
│   │   │   ├── menu.css              # menu page assets (name=menu)
│   │   │   ├── menu.tree.json
│   │   │   ├── menu.animations.css
│   │   │   ├── menu.animations.json
│   │   │   └── menu.stylesheets.json
│   │   │
│   │   ├── interactive/              # Webflow-component runtime plugins
│   │   │   ├── types.ts              # type Plugin = { name; init: (root) => cleanup }
│   │   │   ├── index.ts              # PLUGINS registry
│   │   │   ├── dropdown.ts           # w-dropdown (hover/click/keyboard/outside-close)
│   │   │   ├── tabs.ts               # w-tabs (click + arrow keys + Enter/Space)
│   │   │   └── currentLink.ts        # .w--current / aria-current per pathname
│   │   │
│   │   └── shared/                   # extracted shared components (managed by /extract_components)
│   │       ├── manifest.json         # { ComponentName: { file, classSignature, extractedFrom, skipFromTree } }
│   │       ├── Header.tsx            # navbar + dropdown + cta
│   │       ├── Footer.tsx            # newsletter + footer-resto
│   │       └── STWrapper.tsx         # scroll-to-top button
│
└── .claude/
    └── skills/
        ├── design_scrapper/SKILL.md     # one-off section → component (live site → React)
        ├── extract_components/SKILL.md  # cloned routes → shared component (dedupe)
        └── connect_pages/SKILL.md       # cloned routes → cross-page navigation (linkMap)
```

---

## 13. For another AI reading this

If you're an AI agent landing on this codebase cold, here's the ~30-second mental model:

1. **The product** clones live websites into Next.js apps that mirror the source URL paths. The home → `/`, `/menu` → `/menu`. Visual fidelity is 1:1.

2. **The architecture** is "capture, transform, render." The capture (`scripts/extract-*.mjs` via Playwright) is non-deterministic — it observes a live target. The transform (`scripts/build-*.mjs`) and render (`src/components/`) are deterministic given the captured JSON. Committing `scrapped/` firewalls one from the other.

3. **The runtime** has three parts. (a) `PageRenderer` walks a tree JSON into JSX. (b) `PageReveal` runs an `IntersectionObserver` for scroll-reveal animations. (c) `PageInteractive` runs a plugin registry — each plugin reimplements one Webflow component runtime (dropdown, tabs, current-link). These three wrappers compose in every generated route file.

4. **Adding a page** is a 5-script invocation: `extract:page → extract:ix2 → build:page-css → build:ix2 → wire:route`. The `--name=<slug>` flag scopes the artifacts. `wire:route` writes `src/app/<path>/page.tsx`.

5. **Adding cross-page navigation** is `/connect_pages`. It auto-discovers wired routes, builds `routes.manifest.json`, patches `PageRenderer` to take `linkMap`, retrofits route files. Then it audits links and surfaces orphan paths (links to routes you haven't cloned yet).

6. **Deduping shared components** is `/extract_components`. It compares screenshots, verifies structural identity in tree JSONs, and emits `src/components/shared/<Name>.tsx` files. The route files render the shared component AND pass `skip={['class-signature']}` to `PageRenderer`. Static state markers (`.w--current`) stay out of the static component — the `currentLink` plugin handles them at runtime.

7. **Adding a new Webflow component runtime** (slider, form, lightbox, etc.) is one new file under `src/components/interactive/<name>.ts`, registered in `index.ts`. The plugin shape is `{ name, init: (root) => cleanup }`. The plugin queries the DOM and toggles state classes.

8. **The skills (`.claude/skills/*/SKILL.md`)** are thoroughly documented — each has phases, edge cases, idempotency tables, and failure modes. Read the relevant SKILL.md before invoking the corresponding slash command; it contains the contract.

9. **The conventions are strict.** Mirror, don't synthesize. Class names verbatim. No CSS Modules. Source CSS rules verbatim. Inline styles only when they came from `style="…"` in the source HTML and aren't IX2 runtime artifacts. Routes mirror source URL paths.

10. **What still hurts.** `w-slider` autoplay, `w-form` submission, `w-lightbox`, `w-nav` mobile, IX2 hover/click effects. All planned. The plugin architecture supports them; the work is per-component logic, not pattern-validation.
