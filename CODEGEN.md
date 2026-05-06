# CODEGEN

The final step of the page-clone pipeline: turn the captured page IR into a real React component, instead of having a runtime tree walker reconstruct one from JSON.

This document is a design spec, not a tutorial. It captures every decision and its reason so the implementation has a single reference, and so we can argue with the spec instead of arguing in code review.

---

## 1. Why this exists

Today the clone pipeline ends like this:

- `scripts/extract-page.mjs` captures a page → `<slug>.tree.json` (tens of thousands of lines)
- The Next route imports the JSON and renders it through `<PageRenderer tree={…} animMap={…} linkMap={…} skip={…} />`
- `PageRenderer` is a generic interpreter: it walks the tree at runtime, applies link rewrites, prunes shared subtrees, and constructs JSX on every render

This is fine for proving the capture works, but it's data-driven in the wrong way:

- React DevTools shows a single opaque `<PageRenderer>` instead of the real component tree.
- The "component" cannot be edited, refactored, or read by a human.
- A 100k-line JSON blob is the source of truth for visible page structure — nobody reads that.
- Type checking sees nothing. The compiler can't help.
- Every render does interpreter work that should have happened at build time.

Codegen flips this. The same JSON IR drives a build-time emitter that writes a normal `.tsx` file. After codegen, the runtime has no interpreter, no tree JSON, no link rewriter, no skip filter. The page is just React components composed together.

---

## 2. The shape

The pipeline has three phases. Phases A and C are deterministic codegen passes. Phase B is the only place a model makes a decision, and it is bounded to picking *seams*, never writing code.

```
Capture
  scripts/extract-page.mjs            (already exists)
  scripts/build-page-css.mjs          (already exists)
  scripts/extract-ix2.mjs             (already exists)
       │
       ▼
  <slug>.tree.json + <slug>.css + <slug>.animations.{json,css}
       │
       ▼
─── Phase A: flat codegen (deterministic, always runs) ────────────────────
  scripts/codegen-page.mjs
       │
       ▼
  src/components/generated/<Slug>.tsx          (one flat file, real JSX)
       │
       ▼
─── Phase B: vision-driven component decisions (skill, separate run) ──────
  /extract_subcomponents skill
    inputs : screenshot, <Slug>.tsx (or tree.json)
    output : [{ selector, name }, …]   ← JSON, never JSX
       │
       ▼
─── Phase C: lift refactor (deterministic) ────────────────────────────────
  scripts/lift-subcomponents.mjs
       │
       ▼
  src/components/generated/<Slug>.tsx          (same file, now with helpers)
```

**Phase A is part of the standard scrape.** It runs on every capture. After Phase A you have a working `.tsx` file you can ship.

**Phase B + C are a standard but discrete second step.** The user runs them when they want the file restructured into reusable components. They are not optional in the long-term workflow but they do not block shipping a flat file.

---

## 3. Core invariants

These are the rules that make the pipeline trustworthy. Violating any of them is a bug, not a tradeoff.

### 3.1. 100% data-driven output

Every value in the generated `.tsx` traces back to a captured byte. Every className, attribute, text node, inline style, href, src, SVG attr — all sourced from `tree.json`, the captured CSS, the animations JSON, or the link manifest.

The codegen never invents a value. If a value is not in the captured data, it does not appear in the output.

This is enforceable. After codegen, a check script can prove it:

- Every `className` token in `<Slug>.tsx` exists in `<slug>.css` (or in a known set of utility tokens).
- Every text node value exists somewhere in `<slug>.tree.json`.
- Every `href` is either a `#`-anchor, an external URL present in the captured tree, or a local path produced by resolving the link manifest.
- Every SVG attribute came from the captured SVG markup.

If the check fails, codegen has a bug. The pipeline never ships invented values.

### 3.2. The agent decides where, never what

The Phase B vision pass is the only non-deterministic step. Its output is structured data (`{selector, name}` records), not JSX. The agent never types a className, attribute, or tag.

There is no "agent reviews and edits the file" step. Once an agent gets to write JSX, the data-driven invariant is gone — class names will drift, text will be paraphrased, attrs will be "improved." Hard wall.

The only string the agent invents is the component *name* (e.g. `MenuItem`). That is bounded to a JS identifier and validated (PascalCase, deduped, fall back to `Item1` / `Item2` / … if collisions or emptiness).

### 3.3. Deterministic where it can be

| Phase | Deterministic? |
| ----- | -------------- |
| A — flat codegen | Yes. Same `tree.json` → same `<Slug>.tsx`, byte-for-byte. |
| B — vision decisions | No. Same screenshot may yield different selector lists across runs. |
| C — lift refactor | Yes, given B's output. |

Implication: A's output is checked in. C's output is also checked in but expect diffs across re-runs of B.

---

## 4. Inputs and outputs

### Capture artifacts (already produced today)

| File | Source | Used by |
| ---- | ------ | ------- |
| `src/components/generated/<slug>.tree.json` | `extract-page.mjs` | A, C |
| `src/components/generated/<slug>.css` | `build-page-css.mjs` | A (verification only) |
| `src/components/generated/<slug>.animations.json` | `extract-ix2.mjs` | A |
| `src/components/generated/<slug>.animations.css` | `build-ix2-runtime.mjs` | (imported by route) |
| `src/components/routes.manifest.json` | `wire-route.mjs` (linkMap) | A |
| `screenshots/<slug>-<viewport>.png` | `screenshot.mjs` | B |

### New artifacts produced by codegen

| File | Phase | Description |
| ---- | ----- | ----------- |
| `src/components/generated/<Slug>.tsx` | A (overwritten by C) | The page body as a real component |
| `src/components/generated/<slug>.subcomponents.json` | B | Vision decisions: `[{ selector, name }, …]` |

### What the route file looks like after codegen

```tsx
// src/app/menu/page.tsx — after codegen
import { Menu } from '@/components/generated/Menu'
import { Header } from '@/components/shared/Header'
import { Footer } from '@/components/shared/Footer'
import { STWrapper } from '@/components/shared/STWrapper'
import { PageReveal } from '@/components/PageReveal'
import { PageInteractive } from '@/components/PageInteractive'
import '@/components/generated/menu.css'
import '@/components/generated/menu.animations.css'

export default function Page() {
  return (
    <PageReveal>
      <PageInteractive />
      <Header />
      <Menu />
      <Footer />
      <STWrapper />
    </PageReveal>
  )
}
```

No `PageRenderer`. No tree import. No `animMap` prop. No `linkMap` prop. No `skip` prop. The route is a plain component composition.

---

## 5. Locked decisions

### D1. Resolve at codegen, not at runtime

`linkMap` rewrites and the `skip` list are baked into the output at codegen time, not threaded through props at render time.

- An `<a href="https://www.bloomroomsocial.com/menu">` becomes `<a href="/menu">` in the gen'd file directly. No runtime rewrite.
- A subtree marked for skipping (because it was hoisted into a shared `Header` / `Footer`) is *not emitted* by codegen. The output simply doesn't contain those nodes.

Cost: if the link map or skip list changes, the affected pages must be re-codegenned. Re-codegen is cheap and idempotent, so this is fine.

Benefit: zero runtime work, zero indirection, the gen'd file is what it looks like.

### D2. Inline `style={…}` is allowed, mirroring the captured `style` attribute

The user's general rule for hand-written components is "no inline styles, use className + CSS Modules." For *this* pipeline that rule is explicitly relaxed: when a captured node has an `inlineStyle`, codegen emits `style={{ … }}` mirroring those values.

Reason: the captured `style` attribute is part of the source page's truth. Translating it into a synthetic CSS Module rule would be inventing structure (a class name, a selector specificity choice) that wasn't in the source. The data-driven invariant says we don't invent.

The IX2 runtime-injected style keys (`opacity`, `transform`, `transformStyle`) are stripped before emit, exactly as the current `PageRenderer` does at render time. Those are not source values; they are interpreter artifacts captured by Playwright after IX2 had already mutated the DOM.

### D3. One `.tsx` per page; lifted helpers are local to that file

A page produces a single file: `<Slug>.tsx`. Helpers extracted by the Phase C lift pass are declared at the top of the same file, not split into separate files.

Reason: keeps the "one page = one file" mental model. Cross-page sharing already has a home in `src/components/shared/` via `extract_components`. Within-page DRY is a different concern and lives inline.

### D4. SVGs parse into real JSX

A captured `<svg>` is parsed and emitted as literal JSX. Attributes are converted (`class` → `className`, `stroke-width` → `strokeWidth`, `xlink:href` → `xlinkHref`, etc.). Text content inside `<text>` nodes is preserved.

Fallback: if the parse fails for a specific SVG (malformed input, unsupported feature), that one node falls back to `<span dangerouslySetInnerHTML={{ __html: rawSvgString }} />` and a warning is logged. The pipeline does not abort.

### D5. Codegen always overwrites; the user never hand-edits gen'd files

`<Slug>.tsx` is an artifact, not source. Re-running codegen replaces it. There is no "merge with manual edits" step. If the user wants to fork the output for hand-editing, they copy it elsewhere — outside `src/components/generated/`.

This is the same model `tree.json` has today.

### D6. Phase B (vision) is a discrete second step, not part of the standard scrape

The standard scrape (A) always finishes with a flat `<Slug>.tsx`. Phase B is invoked separately via the `/extract_subcomponents` skill.

Reason: A is fast, deterministic, and free. B costs API tokens and is non-deterministic. Coupling them would force every scrape to wait for and pay for vision, even when the user just wants to re-capture a page after a content change.

---

## 6. What dies, what stays, what changes

### Dies (after every page has been migrated)

- `src/components/generated/PageRenderer.tsx` — runtime tree interpreter. Unused.
- `tree.json` import in route files. Routes no longer reference the IR.
- `animMap` prop, `linkMap` prop, `skip` prop in route files. All baked in at codegen.
- The runtime link rewriter (`rewriteLink` in `PageRenderer.tsx`).
- The runtime skip filter (`subtreeMatchesSkip` in `PageRenderer.tsx`).
- The runtime IX2 inline-style filter. Moves to codegen.
- The `SHARED_SKIP` constant in route files.

### Stays

- `src/components/PageReveal.tsx` — behavioral wrapper, not structural. Still wraps the route.
- `src/components/PageInteractive.tsx` — behavioral wrapper. Stays.
- `src/components/shared/Header.tsx` / `Footer.tsx` / `STWrapper.tsx` — already real components. Unaffected.
- `src/components/shared/manifest.json` — used by `extract_components`. Stays.
- `src/components/routes.manifest.json` (linkMap) — used by codegen now instead of by the runtime renderer. Stays as the source of truth for link rewriting.
- `<slug>.tree.json` — kept on disk as the IR, consumed by codegen. Not imported by the runtime.
- `<slug>.animations.json` — referenced by codegen to emit `data-anim` attributes. Not imported at runtime as a prop.
- `<slug>.css` and `<slug>.animations.css` — still imported at runtime, exactly as today.

### Changes

- Route files (`src/app/<route>/page.tsx`) become pure component compositions (see §4 example).
- `connect_pages` and `extract_components` skills change shape. See §11.

---

## 7. Phase A — flat codegen (deterministic)

`scripts/codegen-page.mjs <slug>`

### 7.1. Inputs

- `src/components/generated/<slug>.tree.json` — DOM tree IR
- `src/components/generated/<slug>.animations.json` — `data-w-id` → animation effect mapping
- `src/components/routes.manifest.json` — link map (sourceUrl → localPath)
- `src/components/shared/manifest.json` — skip list (class signatures of hoisted subtrees)

### 7.2. Output

`src/components/generated/<Slug>.tsx` containing a single default-exported component.

### 7.3. Algorithm

1. Load all inputs.
2. Walk the tree. The root is `<body>`; emit only its children (the route already provides `<body>`).
3. For each node:
   - If it matches a skip signature (class join), prune the subtree.
   - If it is a strip tag (`script`, `noscript`, `link`, `meta`, `style`), prune.
   - If it is `<svg>`, parse and emit JSX (see §7.4).
   - Otherwise, emit `<Tag …attrs>{children}</Tag>` (or self-close for void tags).
4. Attribute emission rules:
   - `classes` → `className="…"`.
   - `inlineStyle` → parse, drop IX2-injected keys, emit `style={{ … }}`.
   - `props["data-w-id"]` → if there is an entry in animations JSON, emit `data-anim="<effect>"`; the original `data-w-id` is dropped.
   - Other `data-w-*` props are dropped (Webflow runtime hooks, no longer needed).
   - `href` and `action` are resolved through the link map at codegen time.
   - Reserved keys (`_base64Note`, `_svgNote`, `[onClick]`) are dropped.
5. Text node emission rules:
   - JSX-escape `{`, `}`, `<`, `>`, `&`. Wrap text in `{'…'}` only when necessary.
   - Whitespace-only text between elements is preserved (Webflow markup depends on it).
6. Write the file. Format is `// THIS FILE IS GENERATED. DO NOT EDIT. // Source: <slug>.tree.json + …` as the first lines.

### 7.4. SVG sub-emitter

Inputs: a captured raw SVG string.

Algorithm:

1. Parse with a strict XML parser.
2. Walk the SVG node tree.
3. Convert each attribute name from kebab-case to camelCase (`stroke-width` → `strokeWidth`, `text-anchor` → `textAnchor`).
4. Convert namespaced attrs: `xlink:href` → `xlinkHref`, `xml:space` → `xmlSpace`.
5. Convert `class` → `className`.
6. Drop invalid-in-JSX attrs (`xmlns:xlink` is fine; namespace declarations on the root pass through).
7. Emit JSX.
8. On parse failure, return `null` and let the caller fall back to `dangerouslySetInnerHTML`.

### 7.5. Verification step (runs after emit)

Codegen finishes by running the data-driven check (§3.1). On failure: print the offending value, the expected source, and exit non-zero. Do not ship.

---

## 8. Phase B — vision skill

`/extract_subcomponents <slug>`

### 8.1. Inputs

- `screenshots/<slug>-<viewport>.png` — full-page screenshot
- `src/components/generated/<Slug>.tsx` — the flat output from Phase A (for context only; the agent does not edit it)

### 8.2. Output

`src/components/generated/<slug>.subcomponents.json`:

```json
[
  { "selector": ".menu-list .menu-item", "name": "MenuItem" },
  { "selector": ".footer .footer-col",   "name": "FooterColumn" }
]
```

This is the only thing the skill writes. No JSX, no code, no edits to `<Slug>.tsx`.

### 8.3. Agent prompt shape

The skill loads the screenshot and the flat `.tsx`, then prompts the agent with something like:

> Look at this screenshot of the cloned page. Identify visually obvious repeating elements — menu items, cards, nav links, footer columns, list rows. For each, return a CSS selector that matches all instances and a PascalCase name.
>
> Aim for 7/10. Don't over-fragment. If nothing obvious repeats, return an empty list.
>
> The output must be a JSON array of `{selector, name}`. Do not include any code, explanation, or markdown.

### 8.4. Constraints on the agent's output

- `selector` must be a valid CSS selector that resolves against the captured tree (validated by the skill, not the agent).
- `name` must be a valid JS identifier in PascalCase. Validated and normalized (e.g. `menu item` → `MenuItem`).
- Duplicate names are deduped with numeric suffixes (`Item`, `Item2`, `Item3`).
- An empty list is a valid output. Phase C does nothing in that case and `<Slug>.tsx` is unchanged.

### 8.5. Failure modes

- Agent returns invalid JSON → skill logs and writes an empty `subcomponents.json`. Pipeline succeeds; Phase C does nothing.
- Agent returns a selector that matches zero subtrees → that entry is dropped with a warning. Other entries still process.
- Agent returns selectors that match overlapping subtrees → the outer match wins. The inner match is logged and skipped. (Lifting overlapping selectors creates ambiguous output.)

---

## 9. Phase C — lift refactor (deterministic)

`scripts/lift-subcomponents.mjs <slug>`

### 9.1. Inputs

- `src/components/generated/<slug>.subcomponents.json` — Phase B's output
- `src/components/generated/<slug>.tree.json` — the IR (re-walked, not the emitted `.tsx`)
- The current flat `<Slug>.tsx` (overwritten on success)

Lifting works against the IR, not the emitted JSX, because the IR is structured. The flat `.tsx` is always re-emittable from the IR + decisions.

### 9.2. Output

`src/components/generated/<Slug>.tsx`, rewritten with:
- Local helper components for each successfully lifted selector, declared above the default export.
- The default export's body uses `<MenuItem … />` style references in place of the original subtrees.

### 9.3. Algorithm

For each `{selector, name}` decision:

1. Find all matching subtrees in the IR.
2. Validate structural equivalence: every match must have the same shape (same tag tree, same class tokens at each position, same attribute keys). Leaf values (text, href, src, alt) are allowed to differ — those are the props.
3. If matches are not structurally equivalent → log a warning, skip this decision, move on. The subtrees stay inlined in the output.
4. Diff the matches to identify which leaf positions vary across instances. Each varying position becomes a prop:
   - Text node values → string props.
   - `href` / `src` / `alt` / `title` attribute values → string props.
   - Numeric-looking values stay strings (codegen does not infer types beyond string).
5. Generate a prop name for each varying position: derived from the surrounding context (e.g. `<a>` text → `label`, `<img>` src → `src`, etc.). Collisions get numeric suffixes.
6. Emit the helper component using the structural template, with the varying positions as `{props.label}` etc.
7. In the page body, replace each match with `<Name prop1={…} prop2={…} />` filled from the captured leaves.

After all decisions are processed, emit `<Slug>.tsx` and re-run the §3.1 verification check.

### 9.4. Edge cases

- A selector matches a subtree that itself contains another lifted subtree (nested lifting) → process the outer first, then the inner inside the helper. This requires lifting in dependency order; sort selectors by tree depth (shallowest first) before processing.
- A lifted helper has zero varying positions (all matches are byte-identical) → it takes no props. Emit `<Name />`.
- A helper would contain only one prop and one text node (e.g. `function Label({ text }) { return <span>{text}</span> }`) → emit it anyway. Threshold filtering happened in Phase B; if the agent decided this is a component, it is.

---

## 10. Verification — the data-driven guarantee

A check script runs at the end of A and at the end of C. It enforces §3.1. It is the difference between a trustworthy pipeline and a hopeful one.

`scripts/verify-codegen.mjs <slug>`

Checks:

1. **className tokens.** Every space-separated token in every `className` in `<Slug>.tsx` exists as a class selector in `<slug>.css`, OR is a known framework token (none today; reserve for future).
2. **Text nodes.** Every text node value in `<Slug>.tsx` (after JSX-unescape) appears as a text node value somewhere in `<slug>.tree.json`.
3. **`href` attributes.** Every `href` value is one of:
   - `#` or `#anchor`
   - A local path that the link manifest maps from a captured source URL
   - An external URL (different domain than any source URL in the manifest) that appeared in `<slug>.tree.json`
4. **`src` attributes.** Every `src` value appears in `<slug>.tree.json`.
5. **SVG content.** For nodes that emitted parsed SVG, the parsed structure round-trips: re-serializing it produces something with the same set of tags and attribute names as the captured raw markup.

Any failure prints the offending value and the path in `<Slug>.tsx`, and exits non-zero.

---

## 11. Interaction with existing skills

### `connect_pages` (today: runtime link rewrite)

Today this skill maintains `routes.manifest.json` and trusts `PageRenderer` to apply the rewrite at render time. After codegen, the rewrite happens at codegen time.

New shape: `connect_pages` updates `routes.manifest.json`, then re-runs Phase A codegen on every cloned page. Produces a diff in each `<Slug>.tsx` instead of leaving the manifest as the only changed file. Audit step (the "which links resolve locally vs. still external") is unchanged — it can scan the gen'd `.tsx` files directly.

### `extract_components` (today: shared component dedup)

Today this skill writes a shared component (`Header.tsx`), updates `shared/manifest.json` with class signatures to skip, and edits route files to thread `skip={[…]}` into `PageRenderer`.

New shape: same shared component, same manifest, but the "skip" mechanism is realized at codegen time. After updating the manifest, the skill re-runs Phase A on every affected page, producing `<Slug>.tsx` files that no longer contain the hoisted subtree. Route files are also edited (less heavily — they just gain `<Header />` etc. and lose the now-redundant `skip` prop; the `PageRenderer` reference is already gone post-migration).

### `design_scrapper`

Unaffected. It operates on a single user-pasted JSON section and emits a one-off React file. Different lifecycle from the page-clone pipeline.

---

## 12. Naming conventions

| Thing | Form | Example |
| ----- | ---- | ------- |
| Page slug (filesystem-friendly) | kebab-case | `menu`, `gift-cards` |
| Generated component file | PascalCase | `Menu.tsx`, `GiftCards.tsx` |
| Generated CSS file | kebab-case | `menu.css` |
| IR file | kebab-case | `menu.tree.json` |
| Decisions file | kebab-case | `menu.subcomponents.json` |
| Lifted helper component | PascalCase, agent-supplied, validated | `MenuItem`, `FooterColumn` |
| Helper prop | derived from context | `label`, `href`, `src` |

---

## 13. Out of scope (for now)

- **Cross-page shared lifting.** If `MenuItem` shape appears in multiple cloned pages, Phase C currently lifts it per-page. A future pass could promote it to `src/components/shared/`. Not built yet because we don't know what the per-page output looks like first.
- **Hand-edit support.** D5 is firm: no merge step. If users start hand-editing gen'd files this will need revisiting, but solving it speculatively is wasted work.
- **Type inference for props.** All extracted props are typed `string`. No attempt to detect numbers, enums, or unions from captured leaves.
- **SVG-to-component extraction.** SVGs are parsed inline into the gen'd file, not lifted into individual component files. Could change later if SVG reuse across pages becomes a thing.
- **Animation editing.** `data-anim` attrs are baked in. The runtime IX2 system reads them. We do not lift animation triggers into JSX or hooks.

---

## 14. Implementation order

The order in which we build this. Each step produces something useful on its own.

1. **Phase A flat codegen — minimal.** Walks the tree, emits JSX with literal text, attrs, classes. Inline styles mirrored. Link map applied. Skip applied. Strip tags pruned. SVGs emitted via `dangerouslySetInnerHTML` (no parser yet).
2. **Migrate `/menu` and `/clone` routes** to the gen'd component. Delete `PageRenderer` import from those routes.
3. **Verification check** (§10). Add to A's pipeline.
4. **SVG parser sub-emitter** (§7.4). Replace the `dangerouslySetInnerHTML` fallback for the common case.
5. **Delete `PageRenderer.tsx`** once no route imports it.
6. **Update `connect_pages`** to re-run codegen after manifest changes.
7. **Update `extract_components`** to re-run codegen after manifest changes.
8. **Phase B — vision skill** (`/extract_subcomponents`).
9. **Phase C — lift refactor.**
10. **Cross-skill polish:** failure modes, empty-decisions handling, structural-equivalence validator.

Steps 1–5 give us the "data-driven invariant" win and let us delete the runtime interpreter. Steps 6–7 keep existing skills working. Steps 8–10 add the vision-driven DRY.

---

## 15. Glossary

- **IR** — Intermediate representation. The captured `<slug>.tree.json`.
- **Flat output** — Phase A's emitted file: a single component with no helper extraction.
- **Lift** — Phase C's operation: replacing repeated inlined subtrees with a single helper component referenced multiple times.
- **Selector** — A CSS-style selector returned by Phase B. Resolved against the captured tree's classes.
- **Decision** — A single `{selector, name}` record from Phase B.
- **Skip signature** — A class join (e.g. `"navbar w-nav"`) used by `extract_components` to mark a subtree for hoisting into a shared component. Resolved at codegen time.
- **Source value** — Any value that came from the captured page (className, text, href, etc.). The data-driven invariant says every value in the output is a source value.
