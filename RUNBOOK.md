# RUNBOOK

Copy-paste-able command recipes for every common operation in the page-clone pipeline. Each recipe is self-contained and lists the commands in the exact order they must run.

> **Read before you run:**
> - `CLAUDE.md` — the orientation document. Read it for the mental model and invariants.
> - `CODEGEN.md` — the design spec for codegen. Read it before changing `scripts/codegen-page.mjs`.
> - `.claude/skills/<name>/SKILL.md` — read the relevant SKILL.md before invoking a slash command.

---

## Prerequisites

Run once when you first land in this repo:

```bash
# 1. Install deps + the Playwright browser binary
npm install
npx playwright install chromium

# 2. Start the dev server (keep this running in a separate terminal)
npm run dev
```

The dev server listens on `http://localhost:3000`. Most recipes below assume it's running. If a recipe says "verify in browser," that means hitting `http://localhost:3000/<route>`.

**Conventions:**
- `<url>` = a full source URL, e.g. `https://www.bloomroomsocial.com/menu`.
- `<slug>` = a kebab-case name for the page artifacts. Default is the last URL segment (`menu` from `/menu`) or `page` for `/`.
- `<PascalSlug>` = `kebab-case → PascalCase` of the slug. `gift-cards` → `GiftCards`. The codegen script computes this from the slug; you don't pass it explicitly.

---

## §1 — Clone a brand-new page (full pipeline)

The end-to-end "I want `<url>` to render at the matching local route" workflow.

### Inputs you need

- `<url>` — the source URL.
- `<slug>` — what to call the artifacts. Convention: derive from the last URL segment.
  - `https://www.bloomroomsocial.com/about` → `about`.
  - `https://www.bloomroomsocial.com/` → `page` (the home is special).

### Six commands

```bash
URL=https://www.bloomroomsocial.com/about
SLUG=about

# 1. Capture the DOM tree + computed styles + source CSS rules at 375px
npm run extract:page    -- $URL --viewport=375 --name=$SLUG

# 2. Capture the IX2 animation timeline
npm run extract:ix2     -- $URL --name=$SLUG

# 3. Build the runtime CSS + tree IR from the capture
npm run build:page-css  -- --name=$SLUG

# 4. Build the IX2 animation CSS + data-w-id → preset map
npm run build:ix2       -- --name=$SLUG

# 5. Generate the Next.js route file (src/app/<path>/page.tsx)
npm run wire:route      -- $URL                 # uses last URL segment as slug

# 6. Generate the React component from the captured tree IR
node scripts/codegen-page.mjs $SLUG             # also runs verify-codegen
```

### Special case: cloning `/` (the home)

The default Next.js scaffolding ships with `src/app/page.tsx`. Wire-route refuses to overwrite it without `--force`. Also use `--path=/` to disambiguate (a bare `/` URL pathname).

```bash
URL=https://www.bloomroomsocial.com/
SLUG=page

npm run extract:page    -- $URL --viewport=375 --name=$SLUG
npm run extract:ix2     -- $URL --name=$SLUG
npm run build:page-css  -- --name=$SLUG
npm run build:ix2       -- --name=$SLUG
npm run wire:route      -- $URL --path=/ --force --name=$SLUG
node scripts/codegen-page.mjs $SLUG
```

### Verifying

After step 6, the verifier runs automatically and prints:

```
[verify:codegen] ✓ <PascalSlug>.tsx is consistent with captured data
[verify:codegen]   classNames : N
[verify:codegen]   texts      : M
[verify:codegen]   hrefs      : K
[verify:codegen]   srcs       : J
```

Then hit the route in a browser:

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/<path>
```

Expected: `HTTP 200`. Open the page in a browser; visually compare to the source.

### Files produced

| Path | What it is |
| --- | --- |
| `scrapped/<slug>-react-page-<viewport>px-<ts>.json` | Raw extract output (gitignored) |
| `scrapped/<slug>-ix2-<ts>.json` | Raw IX2 extract (gitignored) |
| `src/components/generated/<slug>.css` | Runtime CSS (imported by route) |
| `src/components/generated/<slug>.tree.json` | DOM IR (consumed by codegen) |
| `src/components/generated/<slug>.animations.css` | Reveal animations (imported by route) |
| `src/components/generated/<slug>.animations.json` | `data-w-id → preset` (consumed by codegen) |
| `src/components/generated/<PascalSlug>.tsx` | Generated React component |
| `src/app/<path>/page.tsx` | Next.js route file |

---

## §2 — Re-scrape an existing page (source changed)

Use when the live source page changed and you want to refresh the local clone. **Do not** run `wire:route` — the route already exists.

```bash
URL=https://www.bloomroomsocial.com/menu
SLUG=menu

npm run extract:page    -- $URL --viewport=375 --name=$SLUG
npm run extract:ix2     -- $URL --name=$SLUG
npm run build:page-css  -- --name=$SLUG
npm run build:ix2       -- --name=$SLUG
node scripts/codegen-page.mjs $SLUG
```

If you only changed animations (added/removed IX2 effects) and the DOM is unchanged, you can skip `extract:page` and `build:page-css`. But re-running everything is cheap and idempotent — when in doubt, run all five.

If `/connect_pages` had been run previously, the new tree might introduce orphan links (refs to routes that aren't cloned). Re-run `/connect_pages` after step 5 to refresh the manifest and the audit.

---

## §3 — Connect cloned pages (cross-page navigation)

After you've cloned two or more pages, captured `<a href>` values still point at the live URL. `/connect_pages` rewrites them so links resolve locally.

### When to run

- After cloning a new page that links to or is linked from existing cloned pages.
- After re-scraping (the new tree might introduce new links).

### Workflow

```
In Claude:  /connect_pages
```

The skill is fully automated. Behind the scenes:

1. Scans `src/app/**/page.tsx` for the `// Mirrors <url> → <path>` comment that `wire:route` writes.
2. Builds `src/components/routes.manifest.json` (`{ sourceUrl: localPath }`).
3. **Re-runs codegen for every affected slug** — this is the new flow. Manifest changes don't take effect at runtime; they take effect at codegen time. The hrefs are baked into the gen'd `<Slug>.tsx`.
4. Audits every `<a href>` / `<form action>` across the cloned trees and classifies each as wired-relative, wired-absolute, orphan-relative, orphan-absolute, external, anchor, mailto, or tel.
5. Reports orphan paths (links to routes you haven't cloned yet) so you know what to clone next.

### Manual equivalent (if the skill isn't available)

```bash
# Edit src/components/routes.manifest.json by hand (sort keys alphabetically):
{
  "https://www.bloomroomsocial.com/":     "/",
  "https://www.bloomroomsocial.com/menu": "/menu"
}

# Re-run codegen for each affected slug:
node scripts/codegen-page.mjs page
node scripts/codegen-page.mjs menu
```

The codegen rewrite logic lives in `scripts/codegen-page.mjs`'s `rewriteLink()` function. It matches the manifest source URL exactly OR as a prefix followed by `/`, `#`, or `?` (preserves query / hash).

---

## §4 — Extract a shared component across pages

Two cloned pages have an identical header / footer / nav. You want one shared `Header.tsx` instead of the same JSX inlined in both gen'd files.

### When to run

- After cloning a second (or third, etc.) page that visually shares structure with an existing cloned page.

### Workflow

```
In Claude:  /extract_components
```

Or with explicit routes:

```
In Claude:  /extract_components / /menu
```

The skill is fully automated. Behind the scenes:

1. Takes full-page screenshots of every cloned route at 375px.
2. Compares them visually to find candidate sections that appear identical (header, footer, scroll-to-top wrapper, etc.).
3. For each candidate, verifies structural identity by comparing the corresponding subtrees in the per-page `<slug>.tree.json` files.
4. Writes the verified subtree as `src/components/shared/<Name>.tsx` (e.g. `Header.tsx`).
5. Records the extraction in `src/components/shared/manifest.json` with a `skipFromTree` entry — the class signature whose subtree codegen should prune from each gen'd `<Slug>.tsx`.
6. **Re-runs codegen for every affected slug** so the gen'd files no longer inline the extracted subtree.
7. Updates each route file to compose the shared component:

```tsx
<PageReveal>
  <PageInteractive />
  <Header />              {/* ← shared, newly added */}
  <Menu />                {/* ← gen'd, header subtree pruned */}
  <Footer />              {/* ← shared */}
  <STWrapper />           {/* ← shared */}
</PageReveal>
```

### Files produced / modified

| Path | What changes |
| --- | --- |
| `src/components/shared/<Name>.tsx` | New: extracted shared component |
| `src/components/shared/manifest.json` | New entry with `skipFromTree` |
| `src/components/generated/<PascalSlug>.tsx` (each affected) | Header/footer/etc. subtree no longer present |
| `src/app/<route>/page.tsx` (each affected) | Imports + renders the new shared component |

---

## §5 — Lift subcomponents within a page (vision-driven DRY)

You've cloned a page and the gen'd `<Slug>.tsx` is one big flat file. You want it split into named helpers (`MenuItem`, `FooterColumn`, `CardGrid`, etc.) for visually-repeating elements *within the same page*.

This is different from §4. Section 4 dedupes across multiple cloned pages. This recipe DRYs up a single page's gen'd output.

### When to run

- After Phase A codegen produces a working but flat `<Slug>.tsx`.
- The user says "extract subcomponents," "lift repeating elements," "DRY this up."

### Workflow

```
In Claude:  /extract_subcomponents <slug>
```

The skill is vision-driven (Phase B in the codegen design):

1. Loads (or captures fresh) `screenshots/<slug>-375px.png`.
2. Looks at the screenshot. Identifies visually-obvious repeating elements — menu items, cards, nav rows, footer columns.
3. For each, returns a CSS selector + a PascalCase name. **The skill writes only structured JSON.** No JSX.
4. Writes `src/components/generated/<slug>.subcomponents.json`:

```json
[
  { "selector": ".menu-item", "name": "MenuItem" },
  { "selector": ".footer-col", "name": "FooterColumn" }
]
```

5. Re-runs codegen. Codegen reads the decisions file and lifts the matching subtrees into local helper components inside `<Slug>.tsx`.

### What lifting looks like

Before:

```tsx
<li className="menu-item">
  <a href="/menu/tonics">Tonics</a>
</li>
<li className="menu-item">
  <a href="/menu/brunch">Brunch</a>
</li>
<li className="menu-item">
  <a href="/menu/dinner">Dinner</a>
</li>
```

After (helper auto-generated at the top of the same file):

```tsx
function MenuItem({ text, href }: { text: string; href: string }) {
  return (
    <li className="menu-item">
      <a href={href}>{text}</a>
    </li>
  )
}

// …elsewhere in the file body…
<MenuItem text="Tonics" href="/menu/tonics" />
<MenuItem text="Brunch" href="/menu/brunch" />
<MenuItem text="Dinner" href="/menu/dinner" />
```

Props are *derived* by diffing the per-instance leaf values across matching subtrees. The agent does not pick prop names — codegen does.

### Constraints (important)

- The selector grammar is intentionally minimal: tag, `.class`, compound (`.a.b`), descendant (`.parent .child`). No `>`, `+`, `~`, `:hover`, attribute selectors. Keep selectors simple.
- The lift is rejected if the matching subtrees are not structurally equivalent (same tag tree, same classes at each position, only leaf values differ). Codegen warns and skips that decision; other decisions still process.
- Re-running `/extract_subcomponents` may produce different selector lists (vision is non-deterministic). That's fine — re-run with prompt nudges if a pass missed obvious patterns.
- The agent never edits `<Slug>.tsx` directly. The decisions JSON is its only output.

### Manual equivalent (no skill)

If you already know which subtrees to lift, hand-write the decisions file:

```bash
SLUG=menu
cat > src/components/generated/${SLUG}.subcomponents.json << 'EOF'
[
  { "selector": ".menu-item", "name": "MenuItem" }
]
EOF

node scripts/codegen-page.mjs $SLUG
```

Codegen will report which decisions lifted and which were skipped.

---

## §6 — Re-run codegen by itself

When `<slug>.tree.json` / `<slug>.animations.json` / `routes.manifest.json` / `shared/manifest.json` / `<slug>.subcomponents.json` are already up-to-date and you just want to regenerate `<PascalSlug>.tsx`:

```bash
node scripts/codegen-page.mjs <slug>
```

This is idempotent and byte-stable. Same inputs → same `<PascalSlug>.tsx`.

The verifier (`verify-codegen.mjs`) runs as the final step. To run it standalone:

```bash
node scripts/verify-codegen.mjs <slug>
```

Output:

```
[verify:codegen] ✓ <PascalSlug>.tsx is consistent with captured data
[verify:codegen]   classNames : N
[verify:codegen]   texts      : M
[verify:codegen]   hrefs      : K
[verify:codegen]   srcs       : J
```

Verifier failure (non-zero exit, listed violations) means codegen produced a value not present in the captured data. That's a codegen bug — fix the script, do not silence the verifier.

---

## §7 — Multi-breakpoint capture for one page

Capture at multiple viewports and let codegen consume the merged result. The build interleaves source rules across captures and dedupes by `(@media, cssText)`. The smallest viewport's tree is used as the IR.

```bash
URL=https://www.bloomroomsocial.com/menu
SLUG=menu

npm run extract:page    -- $URL \
  --viewport=375 --viewport=768 --viewport=1280 \
  --heights=375:667,768:1024,1280:800 \
  --name=$SLUG

npm run extract:ix2     -- $URL --name=$SLUG
npm run build:page-css  -- --name=$SLUG
npm run build:ix2       -- --name=$SLUG
node scripts/codegen-page.mjs $SLUG
```

Heights matter for `position: fixed; bottom: …` to resolve correctly. Defaults track common device sizes (375×667, 768×1024, 1280×800).

To pick viewports based on what the source page uses:

```bash
npm run detect:breakpoints -- $URL
```

Reports every `min-width` / `max-width` threshold found in the source CSS.

---

## §8 — Clone an entire site (multi-page bash loop)

```bash
DOMAIN=https://www.bloomroomsocial.com

for path in / /menu /about /book; do
  URL=$DOMAIN$path
  if [ "$path" = "/" ]; then
    SLUG=page
  else
    SLUG=${path#/}                          # strip leading /
    SLUG=${SLUG//\//-}                      # nested paths: /a/b → a-b
  fi

  npm run extract:page    -- $URL --viewport=375 --name=$SLUG
  npm run extract:ix2     -- $URL --name=$SLUG
  npm run build:page-css  -- --name=$SLUG
  npm run build:ix2       -- --name=$SLUG

  if [ "$path" = "/" ]; then
    npm run wire:route -- $URL --path=/ --force --name=$SLUG
  else
    npm run wire:route -- $URL --name=$SLUG
  fi

  node scripts/codegen-page.mjs $SLUG
done

# Then in Claude (interactive — these are skills):
#   /connect_pages
#   /extract_components
```

The two skill invocations at the end:
- `/connect_pages` rewires cross-page hrefs (re-runs codegen for affected slugs).
- `/extract_components` dedupes shared header/footer/etc. across the cloned routes (also re-runs codegen).

---

## §9 — Inspect what would lift (without committing)

You want to see what the codegen lift refactor would do, but you haven't run `/extract_subcomponents` yet. You can hand-write a `subcomponents.json` exploring different selectors and re-run codegen — it's idempotent and the verifier will catch bad output.

```bash
SLUG=page

# Try a few selectors:
cat > src/components/generated/${SLUG}.subcomponents.json << 'EOF'
[
  { "selector": ".text-cta", "name": "TextCta" },
  { "selector": ".subtitle-green-3", "name": "SubtitleGreen" }
]
EOF

node scripts/codegen-page.mjs $SLUG
# Inspect the output:
grep -E '^function |^<' src/components/generated/${SLUG^}.tsx | head -20

# If you don't like the result, edit the JSON and re-run.
# Empty JSON [] = flat output (no lift).
```

Codegen reports which decisions lifted:

```
[codegen:page]   Helpers   : 2/2 lifted
[codegen:page]     ✓ TextCta — 3 instances, 1 props
[codegen:page]     ✓ SubtitleGreen — 3 instances, 1 props
```

Or which were rejected:

```
× selector ".card-video" — 9 matches not structurally equivalent, skipped
× selector ".w-slider-dot" — only 1 match, skipped
```

---

## §10 — Reference: every script and its npm alias

| Command | Underlying script | Purpose |
| --- | --- | --- |
| `npm run dev` | `next dev` | Start the Next.js dev server |
| `npm run build` | `next build` | Production build |
| `npm run lint` | `eslint` | Lint |
| `npm run test` / `test:run` / `test:ui` | `vitest` | Vitest test runner |
| `npm run extract:page -- <url> [flags]` | `scripts/extract-page.mjs` | Capture full-page DOM + computed styles + source CSS rules |
| `npm run extract:ix2 -- <url> [flags]` | `scripts/extract-ix2.mjs` | Capture IX2 animation timeline |
| `npm run detect:breakpoints -- <url>` | `scripts/detect-breakpoints.mjs` | Report `@media` thresholds in source CSS |
| `npm run build:page-css [-- --name=<slug>]` | `scripts/build-page-css.mjs` | Captured JSON → `<slug>.css` + `<slug>.tree.json` |
| `npm run build:ix2 [-- --name=<slug>]` | `scripts/build-ix2-runtime.mjs` | IX2 JSON → `<slug>.animations.{css,json}` |
| `npm run wire:route -- <url> [flags]` | `scripts/wire-route.mjs` | URL → `src/app/<path>/page.tsx` (codegen-style route) |
| `npm run codegen:page -- <slug>` | `scripts/codegen-page.mjs` | Tree IR → `<PascalSlug>.tsx` (also runs verify) |
| `npm run verify:codegen -- <slug>` | `scripts/verify-codegen.mjs` | Standalone data-driven invariant check |

`scripts/screenshot.mjs` and `scripts/screenshot-multi.mjs` are also available; called directly by skills (`/extract_components`, `/extract_subcomponents`) — no npm alias.

---

## §11 — Troubleshooting

### Codegen says "verifier failed"

A `className` token, text node, `href`, or `src` in `<PascalSlug>.tsx` doesn't exist in the captured data. The script lists each violation with file + line.

Causes:
1. Codegen logic has a bug (it transformed a captured value into something else).
2. Capture is partial — the IR is missing a class that's referenced.
3. The captured CSS is incomplete (doesn't include rules for that class).

Action: read the violation; cross-reference the offending value against `<slug>.tree.json` (for classes / text / hrefs / srcs) and `<slug>.css` (for class selectors). Fix the upstream cause; never silence the verifier.

### Codegen succeeds but the page renders weird

Causes:
1. CSS capture is incomplete. Re-run `extract:page` + `build:page-css`.
2. IX2 reveal pinned an element invisible. Check inline styles in the gen'd file — `opacity: 0` and `transform: …` should already be stripped, but if a different IX2 artifact leaked through, add it to `IX2_INJECTED_STYLE_KEYS` in `codegen-page.mjs`.
3. A plugin isn't firing. Open DevTools, check for console errors. Plugins live in `src/components/interactive/`.

### `/connect_pages` says "skill not available"

You're outside Claude Code (running this from a non-Claude shell), or the skill isn't registered. Use the manual equivalent in §3.

### Dev server says "Module not found: @/components/generated/<PascalSlug>"

You haven't run codegen yet. Run:

```bash
node scripts/codegen-page.mjs <slug>
```

The route file imports `<PascalSlug>` from `@/components/generated/<PascalSlug>`; that file is created by codegen.

### Wire-route says "Missing generated files"

You skipped a build step. Re-run `extract:page` → `build:page-css` → `extract:ix2` → `build:ix2` for the slug, then re-run `wire:route`.

### `extract:page` hits a network error or stale CDN

Webflow edges sometimes 503 transiently. Retry. If persistent, raise `--timeout` and `--settle`, or capture from a different network.

### Re-extracted at the same timestamp; build picks the wrong file

Unlikely but possible if you re-run within the same second. Delete `scrapped/<slug>-react-page-…json` of the older one before re-extracting, or use `--out=path.json` to control the output filename explicitly.

### Captured `<img src="…cdn.prod.website-files.com…">` 404s in the browser

The Webflow CDN may block hotlinking from non-source origins. Either re-host the assets or set up a proxy. Not a codegen issue.

### TypeScript errors in `src/components/shared/*.tsx`

These are pre-existing from the old `/extract_components` flow (before codegen-style emission existed). They'll be fixed the next time `/extract_components` runs and rewrites the shared components. The codegen-emitted files (`Page.tsx`, `Menu.tsx`) are TS-clean.

---

## §12 — Workflow patterns at a glance

Quick mental shortcut for "what command sequence applies?":

| Situation | Recipe |
| --- | --- |
| New page, no clone yet | §1 |
| Existing page, source changed | §2 |
| Existing page, want hrefs to resolve locally | §3 |
| Multiple pages share a header/footer | §4 |
| One page is too flat, wants helpers | §5 |
| Just need to regenerate `<Slug>.tsx` | §6 |
| Want different breakpoints | §7 |
| Cloning a whole site | §8 |
| Want to test selectors before committing | §9 |

---

## §13 — Idempotency guarantees

- **`extract:*`** is non-deterministic (live target moves). Each run produces a new timestamped JSON in `scrapped/`. Old captures are not overwritten — keep the latest, prune older if you want.
- **`build:*`** is deterministic given the same JSON input. Same JSON in → same `<slug>.{css,tree.json,animations.*}` out.
- **`wire:route`** is idempotent without `--force` (refuses to overwrite). With `--force`, idempotent if the inputs (URL, slug) are the same.
- **`codegen-page.mjs`** is fully deterministic. Same inputs → byte-identical `<PascalSlug>.tsx`. Re-running is always safe.
- **`verify-codegen.mjs`** has no side effects. Read-only.
- **Skills** (`/connect_pages`, `/extract_components`) are designed to be idempotent — re-running with the same state is a no-op or a refresh, not a destructive change. `/extract_subcomponents` is non-deterministic (vision call) but the *output* it produces (decisions JSON → codegen → file) is deterministic given fixed inputs.

In short: if anything looks wrong, re-run. Re-running cannot break a known-good state.
