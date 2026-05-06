# Connect Pages

Rewires internal links in cloned pages so they navigate to the local clone instead of escaping back to the live source. Given a set of routes the user wants "connected," the skill confirms each is wired (`extract → build → wire:route` already run), installs the runtime link rewriter if missing, and audits every `<a href>` / form `action` in each cloned page to report which links will now resolve locally vs. which still point at the live site.

The pipeline today produces routes (e.g. `/clone`, `/menu`) where every captured `<a href="https://www.bloomroomsocial.com/menu">` still points at the live URL — clicking "Menu" on `localhost:3000/clone` jumps to `bloomroomsocial.com/menu` instead of `localhost:3000/menu`. This skill closes that gap.

---

## When to use this skill

- The user has cloned multiple pages and wants them to navigate between each other locally.
- The user says "connect these pages," "wire the links," "fix internal links," or invokes `/connect_pages`.
- The user just added a new cloned page and wants existing pages' links to it to start resolving locally.

**Do not** use this skill to:
- Add brand-new links that don't exist in the captured tree (it doesn't author markup, only rewrites existing hrefs).
- Rewrite asset URLs (image src, video src, font URLs) — those should keep pointing at the original CDN unless the user explicitly self-hosts.
- Modify external links (links to domains other than the source domains in the manifest).

---

## Mental model

Two design decisions, both deliberate:

**1. Runtime rewrite, not build-time tree mutation.** The tree JSONs (`<slug>.tree.json`) are the verbatim capture; mutating them would be undone by the next `build:page-css` re-run. Instead, `PageRenderer` accepts a `linkMap` prop — a `Record<sourceUrl, localPath>` — and rewrites `href` / `action` at render time. Manifest in, transformed JSX out. Tree JSONs stay untouched.

**2. The manifest is auto-derived from `wire:route` history, not hand-curated.** Each generated route file already carries a `// Mirrors <url> → <path>` comment. The skill scans `src/app/**/page.tsx` for that line and builds the map. Re-runs are idempotent and pick up newly-wired routes for free.

```
Capture & build:                 verbatim, never touched again by this skill
  src/components/generated/<slug>.tree.json   contains href="https://…/menu"

Routing manifest:                auto-built from src/app/**/page.tsx headers
  src/components/routes.manifest.json
    { "https://www.bloomroomsocial.com/":     "/clone",
      "https://www.bloomroomsocial.com/menu": "/menu" }

Renderer:                        rewrites href on the fly
  <a href="https://…/menu">  →  <a href="/menu">
```

---

## Required infrastructure (auto-installed on first run)

1. **`src/components/routes.manifest.json`** — the source-URL → local-route map. Created on first run by scanning route files.
2. **`linkMap` prop on `PageRenderer`** — added if not present. Type: `Record<string, string>`. Renderer applies a rewriting helper to every `href` / `action` it emits.
3. **Updated `wire:route` template** — generated route files pass `linkMap={linkMap}` to `<PageRenderer />` after import. Existing route files get the import + prop added on the next run of this skill (idempotent — detects if already present).

If the infrastructure is already in place, skip Phase 3 — go straight to manifest refresh + audit.

### The rewrite helper (canonical)

```ts
export function rewriteLink(
  href: string,
  linkMap: Record<string, string>,
): string {
  if (!href) return href
  // Preserve hash-only and pure-fragment links untouched (`#section`, `#`).
  if (href.startsWith('#')) return href
  // Try exact match first (covers `https://…/menu` exactly).
  if (linkMap[href]) return linkMap[href]
  // Then prefix match — handles `https://…/menu#brunch?ref=foo`.
  for (const [source, local] of Object.entries(linkMap)) {
    if (href.startsWith(source + '/') || href.startsWith(source + '#') || href.startsWith(source + '?')) {
      return local + href.slice(source.length)
    }
  }
  // Same-origin relative (`/menu`, `/about`)? If a manifest entry's local
  // path matches, no rewrite is needed (it's already local). If it doesn't
  // match anything, leave it — could be a route the user hasn't cloned yet.
  return href
}
```

This is conservative: only rewrites when `href` starts with a source URL that's in the manifest. External links, anchor links, and same-origin relative links pass through unchanged.

---

## Phase 1 — Discover wired routes

Scan `src/app/**/page.tsx`. For each file, find the line:

```
// Mirrors <source-url>  →  <local-path>
```

(written by `scripts/wire-route.mjs`). Build:

```ts
{
  [sourceUrl]: localPath,
  ...
}
```

If a route file was hand-edited and the comment was removed, fall back to inferring `localPath` from the file's directory under `src/app/` and ASK the user for the source URL.

Output: discovered routes list. Print as:

```
Discovered 3 wired routes:
  https://www.bloomroomsocial.com/       → /clone
  https://www.bloomroomsocial.com/menu   → /menu
  https://www.bloomroomsocial.com/about  → /about
```

---

## Phase 2 — Validate the user's set

If the user passed an explicit set of routes (e.g. `/connect_pages /clone /menu`):

- Verify each route is in the discovered list.
- If a route was named that doesn't exist (no file under `src/app/<path>/page.tsx`), STOP. Tell the user to clone + wire it first. Don't silently proceed with a partial set — the missing page would be a "link goes to live site" gap.

If no set was passed, default to "all wired routes." Confirm with the user before proceeding (one-line confirmation, not a multi-step Q&A).

---

## Phase 3 — Bootstrap (only on first run)

Skip this phase if `src/components/routes.manifest.json` already exists.

### 3a. Write the manifest

```json
{
  "https://www.bloomroomsocial.com/": "/clone",
  "https://www.bloomroomsocial.com/menu": "/menu"
}
```

Sort keys alphabetically for diff stability.

### 3b. Update `PageRenderer`

Add `linkMap` to the props type and a `rewriteLink` helper. The shape:

```tsx
type LinkMap = Record<string, string>

export function PageRenderer({
  tree, animMap, linkMap, skip,
}: {
  tree: unknown
  animMap: Record<string, string>
  linkMap?: LinkMap
  skip?: string[]
}) { … }
```

Inside `buildAttrs`, after building `attrs`, rewrite link-bearing attributes:

```ts
if (linkMap) {
  if (typeof attrs.href === 'string')   attrs.href   = rewriteLink(attrs.href,   linkMap)
  if (typeof attrs.action === 'string') attrs.action = rewriteLink(attrs.action, linkMap)
}
```

`linkMap` defaults to undefined (no rewrite) — so any route file that hasn't yet been updated keeps working.

### 3c. Update `wire:route` template

In `scripts/wire-route.mjs`, the generated route file contents become:

```tsx
import linkMap from '@/components/routes.manifest.json'
…
<PageRenderer tree={tree} animMap={animMap as Record<string, string>} linkMap={linkMap} />
```

(import + prop). Future `wire:route` runs produce link-aware routes by default.

### 3d. Update existing route files

For each route in the user's set:

- Read `src/app/<path>/page.tsx`.
- If the import + prop are already present, no-op.
- Otherwise: insert the `linkMap` import and add the prop. Preserve everything else verbatim (hand edits, shared-component imports from `extract_components`, etc.).

---

## Phase 4 — Refresh the manifest

If the manifest already existed but new routes have been wired since, refresh it. Read `src/app/**/page.tsx`, rebuild the map, write it back if it differs.

This is an additive/destructive update: removing routes from the set drops them from the manifest. The skill should warn before removing entries (the user might temporarily delete a route file and not want links to it broken).

---

## Phase 5 — Audit cross-page links

For each route in the set, read its `<slug>.tree.json` and walk every node. Collect:

- `props.href` on `<a>` tags.
- `props.action` on `<form>` tags.
- (Optional, if the user opts in) `props.src` on `<iframe>` tags.

For each collected URL, classify:

| Classification | Definition |
|---|---|
| **Internal — wired** | Matches a source URL in the manifest. Will resolve locally at runtime. |
| **Internal — orphan** | Matches the source domain but no manifest entry. Will go to the live site. Candidate for next clone. |
| **External** | Different domain. Pass through unchanged. |
| **Anchor / fragment** | `#…` only. No-op. |
| **Mailto / tel** | `mailto:` / `tel:`. No-op. |

Record counts per route.

Don't classify based on the `linkMap` lookup result alone — also classify by whether the host matches one of the source-URL hosts in the manifest. This is what surfaces the "orphan" case (a `bloomroomsocial.com/careers` link when `/careers` isn't yet cloned).

---

## Phase 6 — Report

Print a structured summary. One block per route, ordered by the user's input order (or alphabetical if none).

```
Connected 3 routes:

  /clone (page.tree.json)
    Internal — wired:    Home → /clone (12), Menu → /menu (3), About → /about (2)
    Internal — orphan:   /careers (1) ⚠ not cloned; clicks will leave the local site
    External:            order.toasttab.com (1), instagram.com (1)

  /menu (menu.tree.json)
    Internal — wired:    Home → /clone (4), About → /about (1)
    Internal — orphan:   (none)
    External:            (none)

  /about (about.tree.json)
    Internal — wired:    Home → /clone (1), Menu → /menu (1)
    Internal — orphan:   /careers (2) ⚠
    External:            (none)

Manifest: src/components/routes.manifest.json (3 entries)
Routes updated: 3 of 3 (linkMap import + prop)

Next steps:
  ⚠ /careers is referenced by 2 routes but not cloned.
    Run: npm run extract:page -- https://www.bloomroomsocial.com/careers --name=careers --viewport=375
         npm run extract:ix2  -- https://www.bloomroomsocial.com/careers --name=careers
         npm run build:page-css -- --name=careers
         npm run build:ix2 -- --name=careers
         npm run wire:route -- https://www.bloomroomsocial.com/careers
         /connect_pages
```

The orphan-route hint at the bottom is the highest-leverage output of this skill — it tells the user exactly what to clone next to make their local site fully self-contained.

---

## Idempotency guarantees

| State | Action |
|---|---|
| Manifest exists, matches discovered routes, all route files import linkMap | Audit only. No mutations. |
| Manifest exists but is stale (route added since last run) | Refresh manifest, update new route file's imports. |
| Manifest exists but extra entries (route deleted) | Warn user. Drop entry only on confirmation. |
| Manifest missing | Bootstrap (Phase 3) then audit. |
| `PageRenderer` lacks `linkMap` prop | Patch it before writing to manifest. |
| Route file lacks `linkMap` import | Insert. Preserve everything else. |
| Route file lacks `linkMap={linkMap}` prop on `<PageRenderer>` | Add it. |

Re-running with the same set is a no-op except for the audit report. Re-running with a smaller set is informational only — don't drop routes from the manifest unless explicitly asked.

---

## Edge cases

- **Trailing slash mismatch.** `https://www.bloomroomsocial.com/menu` vs `https://www.bloomroomsocial.com/menu/`. Treat them as equivalent: when building the manifest, normalize by stripping trailing slashes (except for the root). When matching at runtime, try both forms.
- **Subdomain / `www` differences.** If the source URLs in different captures are inconsistent (`bloomroomsocial.com` vs `www.bloomroomsocial.com`), don't auto-merge — match exactly. Surface the inconsistency as a warning.
- **Query strings on the source side.** A captured `<a href="https://…/menu?utm=foo">` with manifest entry `https://…/menu` → `/menu` should rewrite to `/menu?utm=foo` (preserve the query). The `rewriteLink` prefix-match handles this.
- **Hash fragments.** Same — `…/menu#brunch` rewrites to `/menu#brunch`. Handled by prefix-match.
- **Mixed case in URLs.** Host should be case-insensitive (HTTP standard); path is case-sensitive. Normalize the host to lowercase when building/matching the manifest. Don't touch path case.
- **A page links to itself.** `/clone` containing `<a href="https://…/">` is fine — rewrites to `/clone`, browser handles same-page navigation. No special handling.
- **Link is inside a shared component.** Components extracted by `extract_components` live in `src/components/shared/` as static JSX — those links are NOT processed by `PageRenderer` and won't be rewritten. Two options:
  1. Ask the user to use the shared `rewriteLink` helper when authoring links in shared components.
  2. Auto-rewrite at extraction time (one-time, since shared components are hand-editable after extraction). Favor option 1 — it's explicit and survives manual edits.
  Note this in the audit report when an extracted component contains a link to a wired route.
- **Links inside SVG `<a>` tags.** SVG links use `xlink:href` (legacy) or `href` (modern). Modern is captured as `href`; treat the same. Legacy `xlink:href` is rare on Webflow exports — log a warning if encountered, don't rewrite (the SVG `<a>` element behaves differently from HTML `<a>`).
- **Form actions pointing at the live site.** `<form action="https://…/contact-submit">` — by default these would now POST to the local clone, which doesn't have a handler and will 404. Detect and warn: "Form posts to a wired route which has no handler. Either un-wire that source URL from the manifest, add a Next.js route handler, or rewrite by hand." Don't auto-exclude — leave the rewrite in place; the warning is enough.
- **The user passes an external URL as a route.** E.g. `/connect_pages https://other-site.com/page`. Reject — only routes in the local app are valid input.
- **Captured `el.href` resolves to absolute even for relative source links.** `inspect-in-page.mjs` uses `el.href`, which always returns the absolute URL. So a source `<a href="/menu">` becomes captured `href: "https://www.bloomroomsocial.com/menu"`. The runtime rewrite catches this — same code path as fully-qualified absolute links.

---

## Failure modes (be defensive)

- **Refuse if no routes are wired.** Manifest would be empty; nothing to do.
- **Refuse to write to a route file that doesn't have the auto-generated `// Mirrors …` comment.** The user has hand-rewritten it; re-asserting our edits would clobber their work. Print an instruction telling them how to re-add the imports manually.
- **Refuse to overwrite a manually-edited `routes.manifest.json`.** If the file's first key has a comment indicating manual curation (a JSON5 superset isn't supported, but a sentinel like `"_": "manually curated"` works), leave it alone and just audit.
- **Don't silently drop external links from the audit.** Always include them in the report — the user might want to switch one of them to a local clone later.

---

## Output to the user

Final block, single screen:

```
✓ Connected 3 routes via runtime linkMap rewrite.

  Manifest: src/components/routes.manifest.json (3 entries)
  PageRenderer: linkMap prop installed
  Updated route files: 3

  Internal links wired:    21 across 3 routes
  Internal links orphaned: 3 (1 unique target: /careers — not cloned)
  External links:          5 (kept as-is)

  Reload localhost. Click any "Menu" link on /clone — should resolve locally.
```

If only auditing (no infrastructure changes needed):

```
✓ Audit complete. No infrastructure changes needed.

  [audit table as above]
```

---

## Notes

- This skill is the natural follow-up to `wire:route` — `wire:route` mounts the page at the right URL, this one connects pages to each other. Run order: clone (extract + build) → wire route → connect pages.
- Order vs. `extract_components`: run `extract_components` BEFORE `connect_pages` if possible. If a header is shared and extracted, the shared `Header.tsx` may contain hard-coded links — those need the rewrite helper applied at component-author time. The audit will surface them.
- The skill never hits the network. It works entirely from local files (`src/components/generated/`, `src/app/**/page.tsx`). Live URLs are inferred from comments, not fetched.
- The skill is invoked by the user explicitly. It does not run on every build.
