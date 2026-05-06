# scrapper

Clones any live (Webflow-built) website into a Next.js app, with 1:1 visual fidelity. Every cloned page is exposed at the **same path as the source URL** — `https://www.bloomroomsocial.com/menu` becomes `http://localhost:3000/menu`. Animations, fonts, breakpoints, inline SVGs, slider/dropdown/tab runtimes, and cross-page navigation are all preserved.

The codebase is built around two principles:

1. **Mirror what the original is, don't invent defaults.** Capture is a verbatim observation of the live site (DOM, computed styles, source CSS rules, IX2 animation timeline). Build is a deterministic transformation of that observation into static assets. Codegen turns those assets into a real React component.
2. **Generated code is a build artifact.** Each cloned page ships as a normal React component (`<Page />`, `<Menu />`, …) emitted by `scripts/codegen-page.mjs` from the captured tree IR. There is no DOM-tree interpreter at runtime. The artifact is regenerable, byte-stable, and verified data-driven (every value in it traces back to a captured byte).

> **For agents working in this repo:** read `CLAUDE.md` first (orientation) and `RUNBOOK.md` for command recipes. `CODEGEN.md` is the design spec for the build-time codegen pipeline.

---

## 1. Pipeline overview

The full lifecycle of cloning one page is **five phases**:

```
┌──────────┐   ┌───────┐   ┌──────┐   ┌─────────┐   ┌────────┐
│ extract  │ → │ build │ → │ wire │ → │ codegen │ → │ skills │ (optional)
└──────────┘   └───────┘   └──────┘   └─────────┘   └────────┘

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

wire:route <url>
                                     │
                                     ▼
                       src/app/<path>/page.tsx
                                  (codegen-style: imports <PascalSlug>)

node scripts/codegen-page.mjs <slug>
                                     │
                                     ▼
                       src/components/generated/<PascalSlug>.tsx
                       (verify-codegen.mjs runs as the final step)

(optional)
  /connect_pages                          → manifest + re-codegen for affected slugs
  /extract_components <route1> <route2>   → shared component + manifest + re-codegen
  /extract_subcomponents <slug>           → vision-driven DRY → re-codegen with helpers
  /design_scrapper <url> <selector>       → one-off section → component (separate flow)
```

The `--name=<slug>` flag scopes phases 1 and 2 per page. Default slug is `page` (the home). `wire:route` derives the route path from the source URL automatically. Codegen converts kebab-case slug to PascalCase for the component name (`menu` → `Menu`, `gift-cards` → `GiftCards`).

---

## 2. Quick start (clone two pages)

See `RUNBOOK.md` for the full recipe set. Fast path:

```bash
# 1. Install
npm install
npx playwright install chromium

# 2. Clone the home page (--name=page)
URL=https://www.bloomroomsocial.com/
npm run extract:page    -- $URL --viewport=375 --name=page
npm run extract:ix2     -- $URL --name=page
npm run build:page-css  -- --name=page
npm run build:ix2       -- --name=page
npm run wire:route      -- $URL --path=/ --force --name=page
node scripts/codegen-page.mjs page

# 3. Clone the menu page (--name=menu)
URL=https://www.bloomroomsocial.com/menu
npm run extract:page    -- $URL --viewport=375 --name=menu
npm run extract:ix2     -- $URL --name=menu
npm run build:page-css  -- --name=menu
npm run build:ix2       -- --name=menu
npm run wire:route      -- $URL
node scripts/codegen-page.mjs menu

# 4. Connect them (rewrites cross-page links to local routes; re-runs codegen)
npm run dev
# In Claude:  /connect_pages

# 5. (Optional) Dedupe shared header/footer
# In Claude:  /extract_components

# 6. (Optional) Lift visually-repeating elements within a page
# In Claude:  /extract_subcomponents menu
```

`http://localhost:3000/` mirrors the live home, `http://localhost:3000/menu` mirrors the live menu, the Home / Menu nav links resolve locally between the two.

---

## 3. Architecture mental model

A cloned page is reconstructed from three independent inputs:

| Input | What it is | Captured by | Owns |
|---|---|---|---|
| **Tree JSON** | The DOM structure (tag, classes, attrs, text, inline styles, SVG markup) | `extract:page` | What renders |
| **CSS** | The actual stylesheets the live page used (verbatim, with `@media` wrappers) | `extract:page` | How it looks |
| **Animations JSON** | A `data-w-id → preset` map for IX2 reveals | `extract:ix2` | When elements fade in |

These inputs feed the build (`build:page-css`, `build:ix2`) which emits per-slug assets. Then codegen consumes the tree IR and emits a real React component:

| Layer | Responsibility |
|---|---|
| **`scripts/codegen-page.mjs`** | Walks `<slug>.tree.json` and emits `<PascalSlug>.tsx`. Strips IX2-injected runtime styles (`opacity` / `transform` / `transformStyle`). Looks up the animation preset on each `data-w-id` and emits `data-anim="…"`. Rewrites `<a href>` and `<form action>` via `routes.manifest.json` (link map). Prunes subtrees claimed by shared components via `shared/manifest.json` (skip set). Parses `<svg>` markup into literal JSX. Lifts visually-repeating subtrees into local helpers when `<slug>.subcomponents.json` exists. Ends with a verifier pass enforcing the data-driven invariant. |
| **`scripts/verify-codegen.mjs`** | Proves every `className`, text node, `href`, and `src` in `<PascalSlug>.tsx` traces back to captured data (`<slug>.tree.json`, `<slug>.css`, `routes.manifest.json`). Runs at the end of every codegen run. Failure = codegen bug. |
| **`<PascalSlug>.tsx`** | The generated React component. Plain JSX, no interpreter, no props, no runtime walking. Imported by the route file. |
| **`PageReveal.tsx`** | A client wrapper. Mounts an `IntersectionObserver` over `[data-anim]` elements; adds `is-visible` on intersection (one-shot reveal). The animation CSS reacts to that class. |
| **`PageInteractive.tsx`** | A client wrapper. Iterates a plugin registry: each plugin reimplements one Webflow component runtime (dropdown, tabs, current-link) by attaching listeners and toggling state classes. |
| **`src/components/shared/*`** | Components extracted by `/extract_components` and rendered alongside the gen'd `<Slug />` (`Header`, `Footer`, `STWrapper`). |

The route file (`src/app/<path>/page.tsx`, generated by `wire:route`) is tiny:

```tsx
<PageReveal>
  <PageInteractive />
  <Header />          {/* shared, optional */}
  <Menu />            {/* gen'd by codegen-page.mjs from menu.tree.json */}
  <Footer />          {/* shared, optional */}
  <STWrapper />       {/* shared, optional */}
</PageReveal>
```

There is no `PageRenderer`, no `tree`/`animMap`/`linkMap`/`skip` props, no runtime indirection. Everything is baked in at codegen time.

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

`@font-face` rules for families served by Fontsource (`Arima`, `DM Sans`, `Open Sans` — see `HANDLED_FAMILIES` in the script and [`FONTS.md`](./FONTS.md)) are dropped to avoid double-loading. `:root` custom properties are emitted up front.

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
- Writes a route file that imports `<PascalSlug>` from `@/components/generated/<PascalSlug>` and renders `<PageReveal><PageInteractive /><Slug /></PageReveal>`.
- Refuses to overwrite without `--force`.

The route file imports the gen'd component but does NOT trigger codegen — that's a separate step. After `wire:route`, run `node scripts/codegen-page.mjs <slug>`.

**Flags:** `--name=<slug>`, `--path=/foo`, `--force`.

### `npm run codegen:page -- <slug>`

The Phase A + C codegen. Reads:
- `src/components/generated/<slug>.tree.json` (DOM IR)
- `src/components/generated/<slug>.animations.json` (animation map; optional)
- `src/components/routes.manifest.json` (link map; optional)
- `src/components/shared/manifest.json` (skip-set source; optional)
- `src/components/generated/<slug>.subcomponents.json` (Phase B vision output; optional, drives lift refactor)

Emits `src/components/generated/<PascalSlug>.tsx` and runs the verifier as the final step. Idempotent: same inputs → byte-identical output.

See `CODEGEN.md` for the full design spec.

### `npm run verify:codegen -- <slug>`

Standalone data-driven invariant check. Confirms every `className`, text node, `href`, and `src` in `<PascalSlug>.tsx` traces back to captured data. Read-only; exits non-zero on violation.

### `npm run detect:breakpoints -- <url>`

Walks the page's stylesheets and reports every `min-width` / `max-width` threshold. Useful for picking `--viewport` values for multi-breakpoint capture.

### `scripts/screenshot.mjs` / `scripts/screenshot-multi.mjs`

Full-page Playwright screenshots. Used by `/extract_components` for visual comparison and by `/extract_subcomponents` as input to the vision pass.

---

## 5. Generated assets

Live in `src/components/generated/`. Per-page filenames follow `<slug>.{ext}` for assets and `<PascalSlug>.tsx` for the component.

| File | Producer | Consumer | What's in it |
|---|---|---|---|
| `<slug>.css` | `build:page-css` | route file (CSS import) | Source CSS rules verbatim, grouped + sorted by `@media`. |
| `<slug>.tree.json` | `build:page-css` | `codegen:page` | Captured DOM tree (smallest viewport on multi-capture). |
| `<slug>.animations.css` | `build:ix2` | route file (CSS import) | Three IX2 preset rule pairs. |
| `<slug>.animations.json` | `build:ix2` | `codegen:page` | `data-w-id → preset-name`. |
| `<slug>.subcomponents.json` | `/extract_subcomponents` (Phase B) | `codegen:page` | `[{selector, name}, …]` — drives the lift refactor in codegen. Optional. |
| `<PascalSlug>.tsx` | `codegen:page` | route file (component import) | Generated React component. Static JSX with `href`, `className`, `data-anim`, etc. baked in. Verified data-driven. |

Everything in `generated/` is committed. The build is fast, but Next.js needs the JSON + TSX at compile time, and importing from `scrapped/` would put raw artifacts in the bundle.

---

## 6. Runtime components

### `src/components/generated/<PascalSlug>.tsx`

A normal React component generated by `scripts/codegen-page.mjs` from the captured tree IR. Exports a single named function with the PascalSlug name (`Page`, `Menu`, …). No props, no state, no client-side logic. Imported by the matching route file.

The generation rules (codified in `scripts/codegen-page.mjs`):
- `node.classes` → `className` (verbatim; never renamed; never hashed).
- `node.props` → JSX attributes, except `data-w-*` (used for animation lookup, then dropped) and reserved keys (`_base64Note`, `_svgNote`, `[onClick]`).
- `node.inlineStyle` → `style={…}` after parsing, **with `opacity` / `transform` / `transform-style` always stripped** (those are IX2 runtime artifacts, not source declarations).
- SVG nodes are parsed into literal JSX. On parse failure, fall back to `<span dangerouslySetInnerHTML={{__html: rawMarkup}} />` for that one node.
- `<script>`, `<noscript>`, `<link>`, `<meta>`, `<style>` tags → omitted.
- `node.props['data-w-id']` → looked up in `<slug>.animations.json`; if found, emit `data-anim="<preset>"`.
- `href` and `action` → rewritten via `routes.manifest.json` at codegen time (matches exact + prefix; preserves query / hash; leaves anchor / external links alone).
- Subtrees whose root class signature is in `shared/manifest.json`'s `skipFromTree` are pruned at codegen time (not emitted at all).
- Numeric HTML attrs (`tabIndex`, `width`, `height`, `rowSpan`, `colSpan`) → emit as `attr={N}` when value parses as integer.
- If `<slug>.subcomponents.json` exists, structurally-equivalent matching subtrees are lifted into local helper components at the top of the file with props extracted by per-instance leaf diffing.

The output file ends with the verifier passing on every `className` / text / `href` / `src`.

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

Components extracted by `/extract_components`. These are static React components reused across multiple cloned routes (typically `Header`, `Footer`, `STWrapper`). The route file renders them alongside the gen'd `<Slug />` and the codegen reads `shared/manifest.json` to know which subtrees to prune from the gen'd file.

Page-dependent state (`.w--current` on the active nav link, `aria-current="page"`) is intentionally NOT baked into these static components. The `currentLink` plugin applies it at runtime based on `window.location.pathname`.

### `src/components/routes.manifest.json`

The link map: `{ sourceUrl: localPath }`. Auto-derived by `/connect_pages` from the `// Mirrors <url> → <path>` comments in route files. **Read at codegen time** — every captured `href` matching a manifest source is rewritten to the local path, then baked into the gen'd file. Not used at runtime.

### `src/app/layout.tsx` — fonts via Fontsource

Self-hosted Google Fonts (Arima, DM Sans) are imported once at the root layout via `@fontsource/<family>/<weight>.css`. Captured `@font-face` rules for those families are dropped from `<slug>.css` to avoid double-loading. **See [`FONTS.md`](./FONTS.md) for the full setup, weight selection, and how to add a new family.**

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

### `/connect_pages`

**Direction: cloned routes → cross-page navigation.**

Auto-discovers wired routes by scanning `src/app/**/page.tsx` for the `// Mirrors <url> → <path>` comment that `wire:route` writes. Builds `src/components/routes.manifest.json` (`{ sourceUrl: localPath }`, sorted alphabetically). Then **re-runs codegen for every affected slug** so the captured `<a href="https://…/menu">` becomes a literal `href="/menu"` in the gen'd file. The runtime page contains plain hrefs — no `linkMap` prop, no rewrite helper.

After the rewrite, audits every captured `<a href>` / `<form action>` and classifies:
- **wired** — resolves locally.
- **orphan** — points at a path/URL whose host matches the source domain but isn't yet cloned. Will leave the local site on click. The audit lists these so the user knows what to clone next.
- **external** / **anchor** / **mailto** / **tel** — kept as-is.

Idempotent. Re-running with no manifest changes is a no-op except for the audit report.

### `/extract_components`

**Direction: cloned routes → shared component.**

Compares full-page screenshots of two or more cloned routes, identifies visual sections that appear identical across them, verifies structural identity via the per-page tree JSONs, and dedupes them into a shared static React component.

Workflow:
1. Writes `src/components/shared/<Name>.tsx` from the verified subtree (using the same emit conventions as codegen).
2. Updates `src/components/shared/manifest.json` with a `skipFromTree` entry — the class signature codegen prunes from each gen'd `<Slug>.tsx`.
3. **Re-runs codegen for every affected slug.** Output: gen'd files no longer contain the inlined header/footer/etc.
4. Updates each route file to compose `<Header />` / `<Footer />` / etc. alongside the gen'd `<Slug />`.

Page-dependent state (active nav link) lives in the `currentLink` plugin, not in the static component.

Idempotent. Re-runs detect existing extractions via the manifest hash.

### `/extract_subcomponents`

**Direction: one cloned page → DRY helpers.**

Vision-driven Phase B of the codegen pipeline. Looks at a screenshot of a cloned page, identifies visually-obvious repeating elements (menu items, cards, footer columns), and writes selector + name decisions to `src/components/generated/<slug>.subcomponents.json`. Then re-runs codegen — codegen reads the decisions and lifts matching subtrees into local helper components inside `<Slug>.tsx`.

The skill's output is **structured JSON only**. The agent never writes JSX. Codegen does the lifting, validates structural equivalence, and extracts props by per-instance leaf diffing. If a decision's matches differ in shape, codegen logs a warning and skips that decision; other decisions still process.

The selector grammar is intentionally minimal: tag, `.class`, compound (`.a.b`), descendant (`.parent .child`). No combinators.

Non-deterministic by design (vision call). Re-run with prompt nudges if a pass missed obvious patterns.

### `/design_scrapper`

**Direction: live website → React component (one-off section).**

Generates a browser console script the user pastes into DevTools. The script extracts a tree of computed styles + props for the selector and downloads a JSON. Claude reads the JSON and emits a `.tsx` component + `.css` file using verbatim Webflow class names.

Different lifecycle from the page-clone flow. Use when the user wants to copy a single section from a live site, not clone the entire site. Output goes to `src/components/generated/ScrappedSection.{tsx,css}` (one-off; not regenerated by codegen).

---

## 9. Workflows

See `RUNBOOK.md` for the complete recipe set. Brief overview:

- **Clone an entire site (multi-page).** Loop the 6-command pipeline; finish with `/connect_pages` and `/extract_components`. RUNBOOK §8.
- **Multi-breakpoint capture.** Pass multiple `--viewport` flags to `extract:page`; the build interleaves source rules across captures. RUNBOOK §7.
- **Re-scrape a page after the source changed.** Re-run `extract:*` + `build:*` + `codegen` for that slug; skip `wire:route`. RUNBOOK §2.
- **Update only IX2 animations.** `extract:ix2` + `build:ix2` + `codegen`. The tree stays valid as long as `data-w-id` values haven't changed.
- **Add a new page after the others are connected.** Full pipeline + `/connect_pages` + (optionally) `/extract_components` and `/extract_subcomponents`.

---

## 10. Conventions and design choices

- **Mirror, don't synthesize.** Source CSS rules are emitted verbatim (units, selectors, `@media` wrappers preserved) instead of being rebuilt from computed styles. Computed styles resolve `%` / `vh` / `calc(...)` to pixels at the capture viewport — wrong at any other size.
- **Class names stay verbatim.** Webflow's `wrapper-center-section-2.valentine-bloomgift` is preserved exactly. Never renamed; never hashed (no CSS Modules).
- **Inline styles are mirrored.** When the source HTML has `style="…"`, codegen emits `style={…}` with the same values, minus IX2 runtime artifacts (`opacity`, `transform`, `transform-style`). The captured `style` attribute is part of the source page's truth; rewriting it as a synthetic CSS Module rule would invent structure.
- **Generated code is a build artifact.** `<PascalSlug>.tsx` is regenerable from `<slug>.tree.json` and the manifests. Treat it like compiled output. Never hand-edit; never check in changes that don't come from a codegen re-run.
- **Data-driven is enforceable.** Every value in a gen'd file traces back to a captured byte. The verifier (`scripts/verify-codegen.mjs`) proves this and runs as the last step of every codegen.
- **The agent makes one decision in this pipeline: where to lift, never what to write.** `/extract_subcomponents` returns `[{selector, name}]` JSON. Codegen does the JSX. There is no "agent edits the .tsx" step.
- **Route paths mirror source URLs.** `/menu` → `/menu`, `/about/team` → `/about/team`. Enforced by `wire:route`.
- **Animations are native CSS.** A 70-line `useEffect` + IntersectionObserver + plain CSS transitions covers the IX2 reveal pattern. No GSAP, no Framer Motion. (For full IX2 hover / click coverage, GSAP is the planned next step — see "Not yet handled.")
- **Webflow-component runtimes are plugins.** Each is independent, queries the document, returns a cleanup. Adding a new component category is a new plugin file, not a new code path through `PageInteractive`.
- **Capture is non-deterministic; build + codegen are deterministic.** Capture observes a live target (Playwright). Build transforms captured JSON into static assets. Codegen transforms those assets into a React component. Same JSON in → byte-identical output. Committing `src/components/generated/` (and not `scrapped/`) firewalls one from the other.
- **`scrapped/` is gitignored by default.** Regenerable from a re-extract. Un-ignore it if you want CI rebuilds without re-hitting the live site.
- **`src/components/generated/` IS committed.** Next.js needs the JSON + TSX at compile time.
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
- Cross-page link rewriting baked into gen'd files via `/connect_pages` (codegen-time).
- Shared component dedup with codegen-time pruning, manifest-driven, idempotent.
- Vision-driven within-page DRY (`/extract_subcomponents`) with structural-equivalence validation.
- Inline-SVG parsing into literal JSX (with `dangerouslySetInnerHTML` fallback).
- Data-driven invariant verifier (`scripts/verify-codegen.mjs`).

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
- **Codegen reads the latest of each manifest at run time.** If you update `routes.manifest.json` or `shared/manifest.json` and don't re-run codegen, the gen'd files are stale. The relevant skills (`/connect_pages`, `/extract_components`) handle the re-run automatically.
- **Captured `style="opacity:0"` on dropdown lists.** Webflow's runtime sets it. The dropdown plugin removes it on init.
- **Dynamic Cloudflare Turnstile widget IDs.** The form input `id` differs per page load. Treated as benign — Turnstile's runtime would replace it anyway.
- **Source page re-publishes.** Re-running `extract:page` may produce different output (DOM tweaks, new content). The build is deterministic per JSON, codegen is deterministic per built assets. Re-running build / codegen / wire doesn't lose anything; `scrapped/` diffs surface regressions if you commit them.
- **Pre-existing TS errors in `src/components/shared/*.tsx`.** Header/Footer/STWrapper were generated by the old `/extract_components` flow before codegen-style emission existed. They have a small set of TS errors (numeric attrs as strings, SVG attrs leaking onto `<span>`). Will be cleaned up the next time `/extract_components` regenerates them. Codegen-emitted files (`Page.tsx`, `Menu.tsx`) are TS-clean.

---

## 12. Project layout

```
.
├── README.md                            this file
├── CLAUDE.md                            agent orientation (auto-loaded entry point)
├── RUNBOOK.md                           command recipes for every common operation
├── CODEGEN.md                           design spec for the codegen pipeline
│
├── scripts/
│   ├── extract-page.mjs                 full-page DOM + CSS + IX2 capture per viewport (--name=<slug>)
│   ├── extract-ix2.mjs                  IX2 timeline + runtime DOM observation (--name=<slug>)
│   ├── inspect-in-page.mjs              browser-side helpers (used by extract-page)
│   ├── detect-breakpoints.mjs           report min-/max-width thresholds in source CSS
│   ├── build-page-css.mjs               react-page JSON → <slug>.css + <slug>.tree.json
│   ├── build-ix2-runtime.mjs            ix2 JSON → <slug>.animations.{css,json}
│   ├── wire-route.mjs                   URL → src/app/<path>/page.tsx (codegen-style)
│   ├── codegen-page.mjs                 <slug>.tree.json → <PascalSlug>.tsx (Phase A + C; runs verify)
│   ├── verify-codegen.mjs               data-driven invariant check (runs at end of codegen)
│   ├── screenshot.mjs                   full-page Playwright screenshot
│   └── screenshot-multi.mjs             multi-URL screenshots (used by /extract_components)
│
├── scrapped/                            raw captures (gitignored; regenerable)
│   ├── <slug>-react-page-<viewport>px-<ts>.json
│   └── <slug>-ix2-<ts>.json
│
├── screenshots/                         gitignored — visual diffs / vision-skill input
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                   Fontsource imports + globals
│   │   ├── globals.css
│   │   ├── page.tsx                     /          → composes <Header /> <Page /> <Footer />
│   │   └── menu/page.tsx                /menu      → composes <Header /> <Menu /> <Footer />
│   │
│   └── components/
│       ├── PageReveal.tsx               'use client' IntersectionObserver wrapper
│       ├── PageInteractive.tsx          'use client' plugin runner
│       ├── routes.manifest.json         { sourceUrl: localPath } — read by codegen, managed by /connect_pages
│       │
│       ├── generated/                   build artifacts (committed)
│       │   ├── Page.tsx                 ← gen'd by codegen-page.mjs from page.tree.json
│       │   ├── Menu.tsx                 ← gen'd by codegen-page.mjs from menu.tree.json
│       │   ├── <slug>.tree.json         IR consumed by codegen
│       │   ├── <slug>.css               imported by route file
│       │   ├── <slug>.animations.css    imported by route file
│       │   ├── <slug>.animations.json   consumed by codegen
│       │   └── <slug>.subcomponents.json   Phase B vision output (optional, drives lift)
│       │
│       ├── interactive/                 Webflow-component runtime plugins
│       │   ├── types.ts                 type Plugin = { name; init: (root) => cleanup }
│       │   ├── index.ts                 PLUGINS registry
│       │   ├── dropdown.ts              w-dropdown (hover/click/keyboard/outside-close)
│       │   ├── tabs.ts                  w-tabs (click + arrow keys + Enter/Space)
│       │   └── currentLink.ts           .w--current / aria-current per pathname
│       │
│       └── shared/                      extracted shared components (managed by /extract_components)
│           ├── manifest.json            { ComponentName: { file, classSignature, skipFromTree, … } }
│           ├── Header.tsx               navbar + dropdown + cta
│           ├── Footer.tsx               newsletter + footer-resto
│           └── STWrapper.tsx            scroll-to-top button
│
└── .claude/
    └── skills/
        ├── design_scrapper/SKILL.md          live URL + selector → React component (one-off)
        ├── extract_components/SKILL.md       cloned routes → shared component (cross-page dedupe)
        ├── extract_subcomponents/SKILL.md    one page → DRY helpers (vision-driven Phase B)
        └── connect_pages/SKILL.md            cloned routes → cross-page navigation
```

---

## 13. For another AI reading this

Read `CLAUDE.md` first. It's the auto-loaded orientation document with the mental model, the hard invariants, the skill map, and the "when the user says X, do Y" reference. Then read `RUNBOOK.md` for command recipes and `CODEGEN.md` for codegen design context.

The 30-second mental model:

1. **The product** clones live websites into Next.js apps that mirror the source URL paths. The home → `/`, `/menu` → `/menu`. Visual fidelity is 1:1.
2. **The architecture** is "capture, build, codegen, render." Capture (Playwright) is non-deterministic. Build + codegen are deterministic. Render is just composition (no interpreter).
3. **A cloned page is a real React component** generated by `scripts/codegen-page.mjs` from the captured tree IR. Plain JSX, no props. Imported by the route file alongside `PageReveal`, `PageInteractive`, and any extracted shared components.
4. **The data-driven invariant is enforceable.** Every value in a gen'd `.tsx` traces back to a captured byte. `scripts/verify-codegen.mjs` proves it; it runs as the last step of every codegen. If it fails, codegen has a bug.
5. **The agent never writes JSX into gen'd files.** `/extract_subcomponents` is the only place an agent makes a non-deterministic decision in this pipeline, and even there it only emits `[{selector, name}]` JSON. Codegen does the lifting.
6. **Adding a page is six commands.** `extract:page` → `extract:ix2` → `build:page-css` → `build:ix2` → `wire:route` → `codegen:page`. The `--name=<slug>` flag scopes the artifacts.
7. **Three skills augment the pipeline.** `/connect_pages` (cross-page hrefs, manifest → re-codegen), `/extract_components` (cross-page shared dedupe, manifest → re-codegen), `/extract_subcomponents` (vision-driven within-page DRY → re-codegen with helpers). All three end in a codegen run. There is no runtime indirection.
8. **The conventions are strict.** Mirror, don't synthesize. Class names verbatim. No CSS Modules. Source CSS rules verbatim. Inline styles mirrored when present in source. Routes mirror source URL paths. Generated code is a build artifact and is overwritten on every codegen run.
9. **What still hurts.** `w-slider` autoplay, `w-form` submission, `w-lightbox`, `w-nav` mobile, IX2 hover/click effects. All planned. The plugin architecture supports them; the work is per-component logic, not pattern-validation.

If you take only one thing from this README: **the gen'd `.tsx` files in `src/components/generated/` are build artifacts.** Treat them like compiled output. Never hand-edit; refine the upstream input (capture, manifest, decisions JSON) and re-run codegen.
