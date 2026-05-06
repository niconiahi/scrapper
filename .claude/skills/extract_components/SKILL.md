# Extract Components

Compares full-page screenshots of two or more cloned routes, identifies visual sections that appear identical across them, and extracts those sections into shared React components — refactoring every referencing route to use the shared component.

The flow is the inverse of the `design_scrapper` skill. `design_scrapper` takes a UI block and turns it into a component. This skill takes UI blocks **already cloned** at multiple routes and dedupes them into one component.

---

## When to use this skill

- The user has just added a new cloned page (e.g. `/menu`) and wants it to share a header / footer / nav with an existing cloned page (e.g. `/clone`).
- The user suspects several routes are repeating the same visual block.
- The user invokes `/extract_components` (typed slash) or asks "dedupe components across these pages."

**Do not** use this skill to:
- Copy a section from one live page into a new component (use `design_scrapper`).
- Refactor differences across breakpoints (use the multi-viewport capture in `extract:page`).
- Style components (CSS dedup happens via Webflow's global class names already; this skill only dedupes JSX).

---

## Mental model

A cloned route renders a generated `<Slug />` component (e.g. `<Page />`, `<Menu />`) produced by `scripts/codegen-page.mjs` from the captured tree IR. Today, two routes that visually share a header would have that header inlined in **both** of their gen'd `.tsx` files — every element duplicated.

After extraction:

```
Before:
  src/components/generated/Page.tsx contains the header inline
  src/components/generated/Menu.tsx contains the header inline
  (no shared component file)

After:
  src/components/shared/Header.tsx                       # one source of truth (JSX)
  src/components/shared/manifest.json                    # records extractions
  src/components/generated/Page.tsx                      # header subtree pruned at codegen
  src/components/generated/Menu.tsx                      # header subtree pruned at codegen
  src/app/clone/page.tsx → <Header /> <Page />           # composes shared + gen'd
  src/app/menu/page.tsx  → <Header /> <Menu />           # same
```

The captured tree JSONs are **left intact** (so `npm run build:page-css` and codegen re-runs are non-destructive). The mechanism is: this skill records `skipFromTree` class signatures in `shared/manifest.json`, and `scripts/codegen-page.mjs` reads that manifest at codegen time and prunes those subtrees from the gen'd `.tsx`. The runtime page is just a composition of `<Header /> <Slug /> <Footer />` — no `skip` prop, no runtime filtering.

---

## Required infrastructure (auto-installed on first run)

The first time this skill runs in a project, it bootstraps:

1. **`src/components/shared/`** directory.
2. **`src/components/shared/manifest.json`** — index of extractions (created empty: `{}`). Codegen reads this and prunes any matching subtrees from each gen'd `<Slug>.tsx`.

That's it. There is no longer a `skip` prop on any runtime component, because there is no runtime renderer — the generated `<Slug>` files are static React components. Codegen does the pruning at build time using `manifest.json`'s `skipFromTree` entries.

If the directory and manifest already exist, skip the install — go straight to phase 1.

---

## Phase 1 — Take the screenshots

Use `scripts/screenshot.mjs` (already in the project). Default URL set:

```bash
node scripts/screenshot.mjs http://localhost:3000/clone http://localhost:3000/menu --viewport=375 --name=extract
```

Override the URL list when the user passes one. Capture at **one viewport** (default 375px). Visual identity at one viewport is sufficient for header/footer extraction; rare for components to be "the same on mobile but different on desktop" in a Webflow clone.

Output: `screenshots/extract-<viewport>px-{local,live}.png` per pair, OR write a one-off Playwright snippet that takes one PNG per URL when comparing >2 routes.

If the dev server isn't running, ask the user to start it (`npm run dev`) — the skill should not start servers itself.

---

## Phase 2 — Identify visual matches

Read every screenshot. Walk top-to-bottom. List visual sections that appear identical across **all** screenshots:

| Region | Class signature heuristic |
|---|---|
| Top bar with logo + nav | `wrapper-navigation`, `nav`, `header-…` |
| Bottom bar with copyright + links | `footer-…`, `footer` tag |
| Mobile menu drawer | `nav-menu`, `mobile-menu` |
| Floating CTA / fixed bar | `cta-floating`, `bottom-bar` |

A match is **only a candidate** at this point — visual identity ≠ structural identity.

For each candidate, record:
- A human name (e.g. `Header`, `Footer`).
- The screenshots showing it.
- The approximate vertical position (top / middle / bottom).

If no candidates emerge, stop and tell the user "no shareable components detected." Do not force extraction.

---

## Phase 3 — Locate candidates in tree JSONs

For each page, read `src/components/generated/<slug>.tree.json`. The tree's root is `<body>`; its `children` are the top-level page sections.

Heuristics:
- **Headers/navbars** → `tree.children[0]` or `tree.children[0].children[0]`.
- **Footers** → `tree.children[tree.children.length - 1]`.
- **Anything else** → walk all top-level body children and match by class signature derived from the screenshot.

Capture for each candidate, in each page:
- The path from root (e.g. `[0, 0]`).
- The root node's full class list (`classes.join(' ')`).
- A subtree summary: tag + class list at depth 0, 1, 2.

---

## Phase 4 — Verify structural identity

For each candidate, compare its subtree across pages. The candidate qualifies for extraction only if **all** of the following hold:

- Same root tag.
- Same root class list (exact match — extra/missing class disqualifies).
- Same number of children at every depth.
- Same tag at every (path, depth) coordinate.
- Same class lists at every coordinate.
- Same text content for `type: 'text'` nodes.
- Same `props` (excluding `data-w-id`, which differs per page since Webflow assigns per-instance IDs).

If any disqualification, **do not extract** — report the divergence point to the user. Two near-identical-but-not subtrees are often a sign that the underlying source pages have a real variant, and parameterizing them via prop is a separate decision the user should make explicitly.

---

## Phase 5 — Check for an existing shared component

Read `src/components/shared/manifest.json`. For each candidate, check whether a component already exists:

- Match by **class signature** (the root class list). Manifest entries store the signature.
- Match by **subtree hash** (a stable hash of the verified subtree — see "Subtree hash" below).

If a match exists:
- Skip extraction.
- If the route in question is not yet in the manifest's `routes` list for that component, **add it** and update the route file to reference the shared component (Phase 7).

If no match, continue to Phase 6.

### Subtree hash

```
hash(node) = sha256(
  node.tag + '|' +
  (node.classes || []).join(' ') + '|' +
  JSON.stringify(node.props || {}, sortedKeys) + '|' +
  (node.children || []).map(hash).join(',')
)
```

`text` nodes hash as `'text|' + node.value`. Strip `data-w-id` from props before hashing — it's per-instance.

Truncate to 12 chars when storing.

---

## Phase 6 — Generate the component

For a new candidate:

### 6a. Pick the component name

Prefer the user's hinted name. Otherwise derive from the root class:
- `wrapper-navigation` → `Header`
- `footer-resto` / `footer-…` → `Footer`
- `mobile-menu` → `MobileMenu`
- Fall back to `PascalCase` of the most distinctive class.

If a name collision exists in `src/components/shared/`, suffix with `2`, `3`, … and warn the user.

### 6b. Emit the component file

Write `src/components/shared/<Name>.tsx`. The body is the subtree converted to JSX, using the same conversion rules as `scripts/codegen-page.mjs`:

- `node.classes` → `className` (verbatim, joined with spaces).
- `node.props` → spread, except: skip `data-w-id`, skip `data-w-*`, skip `_base64Note` / `_svgNote` / `[onClick]`. Resolve `data-w-id` against the captured animations map and emit as `data-anim`. Rewrite `href` / `action` against `routes.manifest.json`.
- `node.inlineStyle` → `style={…}` after parsing, **with** `opacity` / `transform` / `transformStyle` stripped (the IX2 runtime-artifact rule).
- SVG nodes → parse to literal JSX (use `parseSvg` logic from codegen-page.mjs); fall back to `<span dangerouslySetInnerHTML={{ __html: svgMarkup }} />` only if parsing fails.
- `<script>`, `<noscript>`, `<link>`, `<meta>`, `<style>` → omit.
- Text nodes → `{JSON.stringify(value)}` (consistent with codegen).
- Numeric HTML attrs (`tabIndex`, `width`, `height`, `rowSpan`, `colSpan`) → emit as `attr={N}` when value parses as integer.

Reuse `scripts/codegen-page.mjs` as a reference — same emit conventions keep the shared component byte-equivalent to the inlined version codegen would have produced.

Example output for an extracted header:

```tsx
// src/components/shared/Header.tsx
// Auto-extracted by /extract_components from: clone, menu.
// Subtree class signature: wrapper-navigation
// Subtree hash: a1b2c3d4e5f6
//
// You can edit this file by hand. The skill will not overwrite a manually-
// edited component — re-runs detect this file, verify the hash still matches,
// and skip regeneration. If you change the markup such that the hash diverges
// from manifest.json, the skill warns and prompts before any action.
export function Header() {
  return (
    <div className="wrapper-navigation">
      {/* …verbatim subtree… */}
    </div>
  )
}
```

### 6c. Update the manifest

Append (or update) `src/components/shared/manifest.json`:

```json
{
  "Header": {
    "file": "src/components/shared/Header.tsx",
    "classSignature": "wrapper-navigation",
    "subtreeHash": "a1b2c3d4e5f6",
    "extractedFrom": ["page", "menu"],
    "extractedAt": "2026-05-06T19:34:00Z",
    "skipFromTree": ["wrapper-navigation"]
  }
}
```

`skipFromTree` is the list of root class signatures that codegen should omit when emitting any `<Slug>.tsx` that contains them.

---

## Phase 7 — Re-run codegen and update route files

### 7a. Re-run codegen for affected slugs

For each slug that contained the extracted subtree, run codegen so the gen'd `<Slug>.tsx` no longer contains the inlined header/footer:

```bash
node scripts/codegen-page.mjs <slug>
```

Codegen reads `shared/manifest.json` and prunes any subtree whose root class signature appears in `skipFromTree`. The output is byte-stable; re-running with no other change is a no-op.

### 7b. Update route files to compose shared + gen'd

For each route that uses the extracted component, edit `src/app/<path>/page.tsx`:

1. Add `import { Header } from '@/components/shared/Header'` (or whatever component).
2. Render `<Header />` BEFORE `<Slug />` if the component is at the top of the body, AFTER if at the bottom.

Final shape:

```tsx
// Generated by scripts/wire-route.mjs and updated by /extract_components.
import { PageReveal } from '@/components/PageReveal'
import { PageInteractive } from '@/components/PageInteractive'
import { Header } from '@/components/shared/Header'
import { Footer } from '@/components/shared/Footer'
import { Menu } from '@/components/generated/Menu'
import '@/components/generated/menu.css'
import '@/components/generated/menu.animations.css'

export default function Route() {
  return (
    <PageReveal>
      <PageInteractive />
      <Header />
      <Menu />
      <Footer />
    </PageReveal>
  )
}
```

The route file is now hand-edited (no longer fully generated). Mark this with a comment so subsequent `wire:route --force` runs ask before clobbering. Future `wire:route` runs should ideally read `manifest.json` to regenerate the route file with shared components included — track this as a TODO if the wire script doesn't already.

---

## Phase 8 — Verify

After the refactor:

1. `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/clone` → 200.
2. Same for every other route touched.
3. Re-run `scripts/screenshot.mjs` over the same URLs and visually compare against the pre-refactor screenshots — they must be byte-similar (allow a few px of font-render jitter; reject if layout differs).

If a route now renders broken (e.g. header appears twice, or skipped subtree wasn't actually shared), revert that route's file and remove it from the manifest entry.

---

## Idempotency guarantees

Re-running `/extract_components` against the same URL set must be safe:

| State | Action |
|---|---|
| Component file exists, hash matches manifest, route already imports it | No-op; report "already extracted." |
| Component file exists, hash matches, route does NOT import it | Update the route only. |
| Component file exists, hash diverges from manifest | Stop. Warn user (likely they hand-edited the component). Ask whether to update the manifest hash or revert. |
| Component file missing, manifest references it | Stop. Manifest is stale — ask user to delete or restore. |
| Match detected, no existing component | Full extraction. |

The manifest is the source of truth. Treat it as a lockfile: don't blindly overwrite.

---

## Edge cases

- **Subtree appears in tree A but not in tree B's structural slot.** Two pages may put the header at different paths (rare — Webflow nav is usually first). Walk all top-level body children, not just `[0]`, when locating.
- **Subtree appears multiple times on one page.** Each occurrence keeps the subtree in the tree; `skip` only removes top-level body children with that class. If the duplicate is nested deeper, leave it (it's not a layout-level shared component then).
- **Subtree contains a `data-w-id` referenced by IX2 animations.** The extracted component still has the same `data-w-id` on its root, so `<PageInteractive />` and the animation map continue to find it. Verify by checking `<slug>.animations.json` after extraction — entries should still resolve.
- **Subtree contains form / interactive Webflow widgets.** Extraction captures the JSX only; `<PageInteractive />` continues to handle behavior because it queries the document, not a specific tree. No special handling needed.
- **Source page changes.** If `npm run extract:page` re-runs and the captured tree no longer contains the subtree (Webflow redesigned), the skill's next run will detect the missing match and warn — leave the component file alone (user may still want it for fallback) but flag the manifest entry as `stale: true`.
- **Class lists that include state classes** (`.w--current`, `.w--open`). Strip these from the signature when comparing — they're runtime, not structural.
- **A route was wired with `wire:route --force` after extraction.** The shared imports got nuked. Detect by reading the route file: if it doesn't import the component listed in the manifest, re-apply the imports.

---

## Failure modes (be defensive)

- Refuse to extract subtrees deeper than 5 levels by default. Header/footer should be top-level body children. Deep extraction is usually a sign of a misidentified candidate.
- Refuse to extract if the subtree is < 3 nodes (probably trivial, not worth the indirection).
- Refuse to extract if the subtree is > 200 nodes (likely the user is trying to extract half a page; warn and ask for a more specific candidate).
- Refuse to write to `src/components/shared/` if a file with that name exists and was not auto-generated (heuristic: missing the auto-extracted comment header).

---

## Output to the user

After a run, print a concise report:

```
Extracted 1 component, reused 0:
  Header (wrapper-navigation, hash a1b2c3d4e5f6)
    File:     src/components/shared/Header.tsx
    Routes:   /clone, /menu (2 updated)
    Skipped:  wrapper-navigation

Visual diff vs. pre-refactor: identical (verified at 375px).
```

If skipped or rejected:

```
Skipped 1 candidate:
  Footer — class lists differ between page (footer-resto) and menu (footer-resto valentine-variant).
  → Run `/extract_components --parameterize Footer` to extract with a variant prop, or refactor by hand.
```

---

## Notes

- This skill is a **dedupe** tool, not a design tool. It moves existing JSX into a shared file. It does not redesign, retag, or rename anything.
- The skill is invoked by the user; it does not run on every build. The trees in `src/components/generated/` are still rebuilt verbatim by `build:page-css` — the skill's effects only show up in route files and `src/components/shared/`. That separation keeps the extract→build pipeline deterministic.
- The CSS rules for the extracted component remain in each per-page CSS file (`page.css`, `menu.css`). Webflow's global class names are the dedup mechanism for CSS already; we don't move CSS rules between files.
