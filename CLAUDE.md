# CLAUDE.md

Orientation for any Claude Code agent working in this repo. This file is auto-loaded into every session — read it first.

> **For deeper details:**
> - `RUNBOOK.md` — exact command sequences for every common operation (clone a page, re-scrape, extract components, etc.).
> - `CODEGEN.md` — design spec for the build-time codegen pipeline (the heart of the runtime story).
> - `.claude/skills/<name>/SKILL.md` — one per slash command, with phases / edge cases / failure modes.
> - `README.md` — full architecture reference for human readers.

---

## What this repo does

Clones live (Webflow-built) websites into a Next.js app at **mirrored URL paths**. `https://www.bloomroomsocial.com/menu` becomes `http://localhost:3000/menu`, with 1:1 visual fidelity. Every cloned page ships as a real React component generated from the captured DOM tree at build time. The runtime is a thin composition layer; there is no DOM-tree interpreter at request time.

Two pages are clone-ready today: `/` (slug `page`) and `/menu` (slug `menu`).

---

## The pipeline at a glance

Five phases. The first four run as scripts; the fifth is optional and skill-driven.

```
┌──────────┐   ┌───────┐   ┌──────┐   ┌─────────┐   ┌────────┐
│ extract  │ → │ build │ → │ wire │ → │ codegen │ → │ skills │ (optional)
└──────────┘   └───────┘   └──────┘   └─────────┘   └────────┘
   capture       JSON        next         JSX          DRY
   live page    →  CSS       route        + verify     refactor
                                                       links
                                                       shared comp
```

| Phase | Command | Output |
| --- | --- | --- |
| extract | `npm run extract:page -- <url> --name=<slug>` | `scrapped/<slug>-react-page-…json` |
| extract | `npm run extract:ix2 -- <url> --name=<slug>` | `scrapped/<slug>-ix2-…json` |
| build | `npm run build:page-css -- --name=<slug>` | `<slug>.css`, `<slug>.tree.json` |
| build | `npm run build:ix2 -- --name=<slug>` | `<slug>.animations.{css,json}` |
| wire | `npm run wire:route -- <url>` | `src/app/<path>/page.tsx` |
| codegen | `node scripts/codegen-page.mjs <slug>` | `src/components/generated/<PascalSlug>.tsx` |
| skills | `/connect_pages`, `/extract_components`, `/extract_subcomponents` | various |

`<slug>` defaults to the last URL path segment (`menu` for `/menu`) or `page` for `/`. PascalSlug is `kebab-case → PascalCase` (`gift-cards` → `GiftCards`).

See `RUNBOOK.md` for full recipes with concrete example values.

---

## Mental model

A cloned page is reconstructed from three captured inputs:

| Input | What it is | Captured by |
| --- | --- | --- |
| **Tree JSON** | DOM structure (tag, classes, attrs, text, inline styles, SVG markup) | `extract:page` |
| **CSS** | The live site's stylesheets verbatim, grouped by `@media` | `extract:page` |
| **Animations JSON** | `data-w-id → IX2 preset` map | `extract:ix2` |

Codegen consumes these and emits a real React component. The runtime is just composition:

```tsx
// src/app/menu/page.tsx
<PageReveal>
  <PageInteractive />
  <Header />          {/* shared, optional */}
  <Menu />            {/* gen'd from menu.tree.json by codegen */}
  <Footer />          {/* shared, optional */}
  <STWrapper />       {/* shared, optional */}
</PageReveal>
```

There is **no `PageRenderer`**, no `tree` prop, no `animMap` prop, no `linkMap` prop, no `skip` prop. The gen'd `<Menu />` is a normal component containing literal JSX with `href="/menu"`, `data-anim="fadeIn"`, `className="…"` baked in at codegen time.

---

## Hard invariants (do not violate)

These are design guarantees, not preferences. Breaking them is a bug.

### 1. Data-driven output

Every value in a generated `<Slug>.tsx` traces back to a captured byte. Every className comes from `tree.json`'s `classes` arrays or from `<slug>.css`. Every text node value, `href`, `src`, attribute, inline style — all sourced from capture.

Codegen never invents. The verifier (`scripts/verify-codegen.mjs`) enforces this and runs as the final step of every codegen run. If it fails, codegen has a bug — do not silence the verifier; fix the codegen.

### 2. The agent never writes JSX into gen'd files

`<PascalSlug>.tsx` is an *artifact*, not source. It is overwritten by every codegen run. Never hand-edit it. Never instruct the user to hand-edit it. If a gen'd file looks wrong, the bug is upstream — in capture, in codegen, in a manifest, or in a Phase B selector decision.

The Phase B vision skill (`/extract_subcomponents`) is the only place an agent makes a non-deterministic decision in this pipeline, and even there the agent only emits `[{selector, name}]` JSON — never JSX. Codegen does the lifting.

### 3. Mirror what the original is, don't invent defaults

Source CSS rules are emitted verbatim with units, selectors, and `@media` wrappers preserved. Class names are kept exactly as Webflow named them (`wrapper-center-section-2.valentine-bloomgift`). Inline styles are mirrored from the captured `style="…"` attribute when present (with IX2 runtime artifacts — `opacity`, `transform`, `transformStyle` — stripped). Route paths mirror source URL paths.

### 4. `<Slug>.tsx` is regenerable; never check in hand-edits

If you need to deviate from what the source page does, do it in the wrappers (`PageReveal`, `PageInteractive`, plugins) or in `shared/` components — not in the gen'd file. The gen'd file is the build output; treat it like a compiled artifact.

---

## When the user says X, do Y

Quick-reference table for common requests. Each row points to the canonical recipe in `RUNBOOK.md`.

| User intent | What to do | Recipe |
| --- | --- | --- |
| "Clone `<url>`" or "scrape this page into the app" | Full pipeline: extract → build → wire → codegen | RUNBOOK §1 |
| "Re-scrape `/menu`" / "the source changed, update X" | extract → build → codegen (skip wire — already done) | RUNBOOK §2 |
| "Connect / wire / link the pages" / "fix internal links" | Invoke `/connect_pages`. After manifest update, codegen re-runs for affected slugs. | RUNBOOK §3 |
| "Extract the header / dedupe shared sections" | Invoke `/extract_components`. Updates `shared/manifest.json`, then codegen re-runs. | RUNBOOK §4 |
| "Lift these into reusable components" / "DRY up the gen'd file" | Invoke `/extract_subcomponents` (vision-driven). Writes `<slug>.subcomponents.json`, then codegen re-runs and lifts helpers. | RUNBOOK §5 |
| "Just regenerate `<Slug>.tsx`" | `node scripts/codegen-page.mjs <slug>` (idempotent; verifier runs automatically) | RUNBOOK §6 |
| "Check the gen'd file is consistent with the capture" | `node scripts/verify-codegen.mjs <slug>` | RUNBOOK §6 |
| "Copy this section from `<url>` into the app" (one-off, not a full page) | Invoke `/design_scrapper`. Different flow — produces a single component, not a route. | (not in RUNBOOK) |

---

## Skills (slash commands)

All live in `.claude/skills/<name>/SKILL.md`. Read the SKILL.md before invoking — each has phases, idempotency tables, and failure modes.

| Skill | Direction | One-liner |
| --- | --- | --- |
| `/connect_pages` | cloned routes → cross-page navigation | Maintains `routes.manifest.json`. After manifest changes, re-runs codegen for affected slugs so hrefs are baked in. |
| `/extract_components` | cloned routes → shared component | Compares screenshots, finds visually-shared sections (header, footer), promotes them into `src/components/shared/<Name>.tsx`. Updates `shared/manifest.json` with `skipFromTree` so codegen prunes those subtrees from each gen'd `<Slug>.tsx`. |
| `/extract_subcomponents` | one cloned page → DRY helpers | Vision-driven Phase B. Looks at a screenshot, picks visually-repeating elements, returns `[{selector, name}]` JSON. Codegen reads it and lifts matching subtrees into local helpers inside `<Slug>.tsx`. |
| `/design_scrapper` | live URL + selector → one-off React component | Different lifecycle from the page-clone flow. Generates `src/components/generated/ScrappedSection.{tsx,css}` from a single section. Output is hand-editable, not regenerated. |

---

## File layout (active components only — see README §12 for the full tree)

```
.
├── CLAUDE.md                                this file
├── CODEGEN.md                               codegen design spec (read for the why)
├── RUNBOOK.md                               command recipes (read for the how)
├── README.md                                full reference
│
├── scripts/
│   ├── extract-page.mjs                     Playwright DOM + computed-style + source-rule capture
│   ├── extract-ix2.mjs                      IX2 animation timeline capture
│   ├── build-page-css.mjs                   captured JSON → <slug>.css + <slug>.tree.json
│   ├── build-ix2-runtime.mjs                IX2 JSON → <slug>.animations.{css,json}
│   ├── wire-route.mjs                       URL → src/app/<path>/page.tsx (codegen-style)
│   ├── codegen-page.mjs                     <slug>.tree.json → <PascalSlug>.tsx + verify
│   ├── verify-codegen.mjs                   data-driven invariant check
│   ├── inspect-in-page.mjs                  browser-side helpers (used by extract-page)
│   ├── detect-breakpoints.mjs               report @media breakpoints from source CSS
│   ├── screenshot.mjs / screenshot-multi.mjs   Playwright screenshots (used by skills)
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                       Fontsource + globals
│   │   ├── page.tsx                         /          → composes <Header /> <Page /> <Footer />
│   │   └── menu/page.tsx                    /menu      → composes <Header /> <Menu /> <Footer />
│   │
│   └── components/
│       ├── PageReveal.tsx                   'use client' IntersectionObserver wrapper for IX2 reveals
│       ├── PageInteractive.tsx              'use client' plugin runner (dropdown, tabs, currentLink)
│       ├── routes.manifest.json             { sourceUrl: localPath } — read by codegen, managed by /connect_pages
│       │
│       ├── generated/                       build artifacts (committed)
│       │   ├── Page.tsx                     ← gen'd by codegen-page.mjs from page.tree.json
│       │   ├── Menu.tsx                     ← gen'd by codegen-page.mjs from menu.tree.json
│       │   ├── <slug>.tree.json             IR: captured DOM tree
│       │   ├── <slug>.css                   captured stylesheets verbatim
│       │   ├── <slug>.animations.{css,json} IX2 reveal CSS + data-w-id → preset map
│       │   └── <slug>.subcomponents.json    Phase B vision output (optional, drives lift refactor)
│       │
│       ├── interactive/                     Webflow-component runtime plugins
│       │   ├── types.ts                     type Plugin = { name; init: (root) => cleanup }
│       │   ├── index.ts                     PLUGINS registry
│       │   ├── dropdown.ts                  w-dropdown (hover/click/keyboard/outside-close)
│       │   ├── tabs.ts                      w-tabs (click + arrow keys)
│       │   └── currentLink.ts               .w--current per pathname
│       │
│       └── shared/                          extracted shared components (managed by /extract_components)
│           ├── manifest.json                { ComponentName: { file, classSignature, skipFromTree, … } }
│           ├── Header.tsx
│           ├── Footer.tsx
│           └── STWrapper.tsx
│
└── .claude/skills/
    ├── design_scrapper/SKILL.md             live URL + selector → React component (one-off)
    ├── extract_components/SKILL.md          cloned routes → shared component (cross-page dedupe)
    ├── extract_subcomponents/SKILL.md       one page → DRY helpers (vision-driven, Phase B)
    └── connect_pages/SKILL.md               cloned routes → cross-page navigation
```

`scrapped/` (raw captures) and `screenshots/` are gitignored. `src/components/generated/` is committed because Next.js needs the JSON + TSX at compile time.

---

## Common pitfalls and gotchas

### Pipeline-level

- **`scrapped/` is gitignored.** Re-extracting after a `git clone` is required before any build. The latest dump per slug+kind is what `build:*` consumes; older dumps are stale.
- **Wiring `/` requires `--force`.** It overwrites Next.js's default `app/page.tsx`. The default home is the only route that collides.
- **`build:*` reads the *latest* matching JSON in `scrapped/`.** A failed re-extract followed by a build silently uses the prior capture. If output looks stale, check `ls -lt scrapped/`.
- **Codegen output overwrites every run.** Idempotent given the same inputs; deterministic byte-for-byte.

### Codegen-specific

- **`subtreeMatchesSkip` is body-child-only.** Codegen prunes a top-level body child if any descendant matches a `skipFromTree` signature in `shared/manifest.json`. It does NOT recursively prune at every depth — that would be over-aggressive. (PageRenderer had this same semantic.)
- **Lift refactor strict-equivalence.** `/extract_subcomponents` selectors that match instances with differing structural shape are skipped with a warning. The agent should refine the selector, not modify the gen'd output.
- **Numeric HTML attrs.** `tabIndex`, `width`, `height`, `rowSpan`, `colSpan` etc. emit as `attr={N}` (number literal) when value parses as integer. Required by React types.
- **SVG parser fallback.** If the captured `svgMarkup` fails to parse (rare, malformed input), codegen falls back to `<span dangerouslySetInnerHTML={{__html: …}} />` for that one node and logs a warning. Pipeline doesn't abort.

### Skill-specific

- **`/extract_components` requires the dev server running** to take fresh screenshots.
- **`/connect_pages` discovers routes via the `// Mirrors <url> → <path>` comment** in route files. If a route file was hand-rewritten and that comment was lost, the skill won't see it.
- **`/extract_subcomponents` is non-deterministic** by design (vision call). Re-running may produce different selector lists. That's fine for an iterative pass; the user can re-run with prompt nudges if the first pass missed obvious patterns.
- **The agent NEVER edits `<Slug>.tsx` directly.** Even when a skill's output looks "almost right but for one tweak." Refine the upstream input (selector, manifest entry) and re-run codegen.

### Webflow-specific

- **IX2 inline-style stripping.** Captured nodes often have `style="opacity:0; transform:translateY(20px)"` — those are runtime artifacts, not source declarations. Codegen strips `opacity`, `transform`, `transformStyle` from inline styles so the IX2 reveal CSS owns the initial state.
- **Cross-origin image hotlinking.** If the source CDN blocks hotlinking, captured `<img src="…cdn.prod.website-files.com…">` will 404 locally. Re-host or proxy.
- **Dynamic widget IDs (Cloudflare Turnstile, etc.).** Captured `id` may differ from runtime. Treated as benign — the third-party runtime regenerates them.

---

## What's NOT yet handled (future work)

These are known limitations of the runtime, not bugs in the codegen pipeline:

- `w-slider` (autoplay / infinite / swipe) — first slide visible, rest clipped.
- `w-nav` mobile hamburger.
- `w-form` submit (POSTs to a Webflow endpoint that 404s locally).
- `w-lightbox` overlays.
- `w-background-video` intersection-driven play/pause.
- IX2 hover / click effects (~25% of events on a typical Webflow page). Only `SCROLL_INTO_VIEW` reveals (`growIn`, `fadeIn`, `slideInBottom`) are handled today.

Adding any of these is a new plugin under `src/components/interactive/<name>.ts` registered in `index.ts` — no codegen changes required.

---

## A 30-second mental model for cold-start agents

1. **Capture is non-deterministic, build+codegen are deterministic.** The capture observes a live target (Playwright). The build transforms captured JSON into static assets. The codegen transforms those assets into a React component. Same inputs in → byte-identical outputs. Commit `src/components/generated/` so Next.js can compile; don't commit `scrapped/` (regenerable, large).

2. **A gen'd page component is a static React component.** No tree walker at runtime. The route file is `<PageReveal><PageInteractive /><Header /><Slug /><Footer /></PageReveal>` and that's the entire runtime path.

3. **Three skills augment the pipeline.** `/connect_pages` rewires hrefs (manifest → codegen re-run). `/extract_components` promotes shared sections (manifest → codegen re-run, prunes subtrees). `/extract_subcomponents` lifts repeating elements within one page (vision → JSON → codegen lifts helpers).

4. **The data-driven invariant is enforceable.** `verify-codegen.mjs` proves every value in `<Slug>.tsx` exists in the captured data. If the verifier fails, the agent's first instinct should be "where's the codegen bug" — not "patch the .tsx file."

5. **Read CODEGEN.md for design context** before changing anything in `scripts/codegen-page.mjs` or `scripts/verify-codegen.mjs`.

6. **Read RUNBOOK.md before running anything** — copy-paste-able commands with example values.

7. **Read the relevant SKILL.md before invoking a slash command** — each is the contract for that skill.

If you take only one thing from this file: **the gen'd `.tsx` files are build artifacts. Treat them like compiled output. Never hand-edit them; never check in changes to them that don't come from a codegen re-run.**
