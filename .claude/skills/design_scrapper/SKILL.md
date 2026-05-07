---
name: design_scrapper
description: >
  DEPRECATED. The old section-level flow (browser console script + paste JSON
  → hand-editable ScrappedSection.tsx) has been replaced by the page-level
  codegen pipeline documented in RUNBOOK.md and CODEGEN.md. Use this skill
  only as a router: when the user asks to clone, copy, replicate, scrape, or
  rebuild a section/page from a live URL, redirect them to the page pipeline.
  Triggers: "copy this section", "clone this element", "turn this into
  React", "scrape this UI", URL + selector mentions, etc.
---

# design_scrapper — DEPRECATED (router only)

This skill used to drive a one-off section-cloning flow: the user ran a
browser-console script, pasted the resulting JSON, and received a
hand-editable `ScrappedSection.{tsx,css}`. That flow is **deprecated**.

The repo's canonical clone flow is now **page-level**, build-time codegen.
Captures live in `scrapped/`, deterministic transforms produce
`src/components/generated/<PascalSlug>.tsx`, and routes mirror the source
URL path.

**See:**
- `RUNBOOK.md` — copy-pasteable command recipes (start with §1).
- `CODEGEN.md` — design spec for the codegen pipeline.
- `CLAUDE.md` — top-level orientation and the "When the user says X, do Y"
  table.

## What to do when this skill is invoked

1. **Confirm the user wants a full page clone**, not a section. If they
   provided only a URL, that's a page. If they provided a URL + a selector
   for one section of a larger page, ask whether they want:
   - the **whole page** cloned at its mirrored route (recommended,
     supported), or
   - **just that section** as a component (no longer supported as a
     dedicated flow — they'd clone the page and then either let
     `/extract_subcomponents` lift it, or `/extract_components` promote it
     to `src/components/shared/`).

2. **Route them to the page pipeline.** Follow `RUNBOOK.md §1` ("Clone a
   brand-new page"). The five phases are:

   ```
   extract → build → wire → codegen → (optional) skills
   ```

   Concretely (replace `<url>` and `<slug>`):

   ```bash
   npm run extract:page  -- <url> --name=<slug>
   npm run extract:ix2   -- <url> --name=<slug>
   npm run build:page-css -- --name=<slug>
   npm run build:ix2      -- --name=<slug>
   npm run wire:route     -- <url>
   node scripts/codegen-page.mjs <slug>
   ```

   See RUNBOOK §1 for the full recipe (slug rules, the `/` special case,
   verification, files produced).

3. **For follow-up refinements, point at the right skill:**
   - Cross-page navigation / hrefs → `/connect_pages` (RUNBOOK §3).
   - Dedupe shared sections (header/footer) across pages →
     `/extract_components` (RUNBOOK §4).
   - Lift repeating elements within one page into local helpers →
     `/extract_subcomponents` (RUNBOOK §5).

## Why the old flow was retired

The browser-console script captured a single section's computed styles into
ad-hoc JSON, and Claude hand-wrote React from it. That output:

- was **not regenerable** — re-scraping required re-running the console and
  re-prompting Claude;
- was **not data-driven** — Claude inferred component boundaries, names, and
  style strategy from the tree, and could drift from the source;
- did **not integrate** with the rest of the app (no route, no shared
  components, no IX2 animations, no cross-page link rewriting).

The page-level pipeline fixes all of that:

- `extract:page` captures the full page deterministically via Playwright
  (DOM tree + source CSS rules + IX2 timeline).
- `build:*` produces canonical `<slug>.tree.json` / `<slug>.css` /
  `<slug>.animations.{css,json}` artifacts.
- `codegen-page.mjs` emits `<PascalSlug>.tsx` with every value traceable to
  a captured byte; `verify-codegen.mjs` enforces that invariant.
- The route file (`src/app/<path>/page.tsx`) is a thin composition of
  `<PageReveal>`, `<PageInteractive />`, shared components, and the gen'd
  page component.

## Hard rule

**Do not run the old browser-console script and do not produce a hand-written
`ScrappedSection.{tsx,css}`.** If a user explicitly requests the legacy flow
(e.g. they have an old JSON dump they want converted), explain that the flow
has been replaced and offer to clone the page through the canonical
pipeline instead.
