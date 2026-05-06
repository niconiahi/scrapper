---
name: extract_subcomponents
description: >
  Vision-driven Phase B of the codegen pipeline. Looks at a screenshot of a
  cloned page and decides which visually-obvious repeating elements should
  become helper components inside the gen'd <Slug>.tsx. Writes selector +
  name decisions to <slug>.subcomponents.json, then re-runs codegen so the
  helpers materialize. Triggers: "extract subcomponents", "lift repeating
  components", "/extract_subcomponents", or any request to refactor a gen'd
  page into smaller helper components based on visual repetition.
---

# Extract Subcomponents

The final pass of the page-clone pipeline. Phase A codegen produces a flat
`<Slug>.tsx` with every section inlined. This skill looks at the rendered
page (screenshot) and decides which patches of UI are repeating-and-similar
enough to be worth lifting into local helper components.

The agent makes one decision: **where the seams are**. It never writes JSX,
classNames, or attribute values. The deterministic codegen does the actual
lifting from the captured tree IR.

See `CODEGEN.md` §3 (core invariants) and §8 (this skill's spec) for the
philosophy. The hard wall: the agent's output is a JSON list of
`{selector, name}`. Nothing else.

---

## When to use

- The user wants the gen'd page split into smaller reusable pieces.
- The user invokes `/extract_subcomponents` (typed slash) or asks to
  "extract subcomponents", "lift components", "DRY up the gen'd file".
- A page has been cloned (Phase A run) but reads as one giant flat block.

**Do not** use this skill to:
- Extract sections into `src/components/shared/` (use `/extract_components`).
- Split components across breakpoints.
- Edit the gen'd `.tsx` directly (the data-driven invariant forbids it).

---

## Hard rules

1. The agent's output is **structured JSON only**. No JSX, no code, no
   markdown, no commentary in the decisions file.
2. The agent **never edits `<Slug>.tsx`**. Only codegen writes that file.
3. Every selector must be valid CSS (a subset — see Phase 3).
4. Every name must be a PascalCase JS identifier. The skill validates and
   normalizes.
5. If the agent isn't confident a region repeats with similar structure,
   skip it. 7/10 confidence is enough; below that, leave it inlined. The
   user can re-run later.

---

## Phase 1 — Identify the slug

Ask the user which page to process, or pick from
`src/components/generated/*.tree.json` (each `<slug>.tree.json` corresponds
to a page that has been captured and codegen'd).

If the user passes one (e.g. `/extract_subcomponents menu`), use it. If
nothing is passed, list available slugs and ask.

---

## Phase 2 — Capture the screenshot

If `screenshots/<slug>-375px.png` (or similar) exists, prefer reading it.
Otherwise capture a fresh one. The dev server must be running on
`localhost:3000`.

```bash
node scripts/screenshot.mjs http://localhost:3000/<route> --viewport=375 --name=<slug>
```

Pass the full pathname route (`/menu`, `/`, etc.). 375px viewport is enough
for repetition-detection — finer breakpoints rarely change which patches
are "the same component."

If the dev server isn't running, tell the user to start it
(`npm run dev`). The skill does not start servers itself.

---

## Phase 3 — Identify candidate seams

Open the screenshot. Walk it top to bottom. Look for **repeating** UI
patterns: two or more elements that visually share structure but vary in
content. Examples:

- A list of menu items, each with image + title + price + button.
- A grid of cards, each with image + title + caption.
- A row of nav links, each with text + chevron.
- A column of testimonials, each with quote + author + photo.
- A list of social links, each with an icon and label.
- A footer column triplet, each with header + 3 links.

For each candidate, decide:

1. A **CSS selector** that picks out the repeating element. Read
   `src/components/generated/<slug>.tree.json` to confirm the class names.
   Supported selector forms (Phase B parser is intentionally minimal):
   - Tag: `a`, `li`, `section`
   - Class: `.menu-item`, `.card`
   - Compound: `tag.class`, `.class.class`
   - Descendant: `.parent .child` (any depth)
   Not supported: `>`, `+`, `~`, `:hover`, attribute selectors,
   pseudo-classes, `*`, ID selectors. Keep selectors simple.
2. A **PascalCase name**. Derive from a distinctive class name on the root
   if possible (`menu-item` → `MenuItem`). Fall back to a shape-based name
   (`Card`, `NavLink`, `FooterColumn`) when classes are generic.

**Aim for 7/10 confidence.** Three rules of thumb:

- **At least 2 visible instances.** A "repeating" thing has at least two
  copies. The lift refactor needs ≥2 to extract props.
- **Same shape, different content.** If the only difference between
  instances is which icon they show or a 2px border color, that's not
  what we're looking for — the codegen lift would not extract a useful
  prop set. We want instances that have the same skeleton (same tags
  same classes) and differ in text/href/src/alt.
- **Visually obvious.** If you have to squint to see the repetition, skip
  it. Ambiguous candidates are not worth the indirection.

When in doubt, **fewer decisions is better than more**. The user can
always re-run with a different prompt.

If nothing in the screenshot reads as repeating, return an empty list.
Phase A codegen still works; the file just stays flat. That's an
acceptable outcome.

---

## Phase 4 — Validate selectors against the captured tree

Before writing the decisions file, sanity-check each selector. Read
`src/components/generated/<slug>.tree.json` and confirm each selector
matches at least 2 nodes whose subtrees share the same shape.

Quick heuristic: a class that appears in many `classes` arrays in the
tree, where the matching nodes have the same tag and the same number of
children, is a strong signal.

If a selector matches fewer than 2 nodes, drop it. If it matches 2+ but
the matching subtrees clearly differ in tag structure, drop it — the
codegen lift will reject it anyway. Better to omit than to ship a noisy
warning.

---

## Phase 5 — Write the decisions file

Write `src/components/generated/<slug>.subcomponents.json`:

```json
[
  { "selector": ".menu-item", "name": "MenuItem" },
  { "selector": ".footer-col", "name": "FooterColumn" }
]
```

That is the ENTIRE output. No comments, no metadata, no nested objects.
The file is overwritten on every run; previous decisions do not persist.

If the decision list is empty, write `[]` (empty array). Codegen will
treat the page as flat.

---

## Phase 6 — Re-run codegen

```bash
node scripts/codegen-page.mjs <slug>
```

The script picks up `<slug>.subcomponents.json` automatically, lifts the
matching subtrees into helpers, and rewrites `<Slug>.tsx`. The verifier
runs as part of codegen — if any decision produces invalid output, the
verifier catches it before the file is shipped.

Codegen will report which decisions actually lifted. Possible outcomes
per decision:

| Codegen says | Meaning |
| ------------ | ------- |
| `✓ Name — N instances, M props` | Lifted successfully. |
| `× selector "X" — invalid syntax, skipped` | Selector contains unsupported combinators or characters. |
| `× selector "X" — only N match, skipped` | Fewer than 2 matches found. |
| `× selector "X" — N matches not structurally equivalent, skipped` | Matches differ in shape; can't lift cleanly. |

Show the codegen output to the user. If many decisions failed, that's a
hint your selectors were too loose or your visual reads were off — re-run
with refined selectors, don't try to "fix up" the generated file.

---

## What gets emitted

Each lifted decision becomes a local helper at the top of `<Slug>.tsx`:

```tsx
function MenuItem({ text, href }: { text: string; href: string }) {
  return (
    <li className="menu-item">
      <a href={href}>{text}</a>
    </li>
  )
}
```

And the body of `<Slug>` calls them:

```tsx
<MenuItem text="Tonics" href="/menu/tonics" />
<MenuItem text="Brunch" href="/menu/brunch" />
```

Props are extracted **mechanically** by the lift refactor — they come
from diffing the per-instance leaf values in the captured tree. The agent
does not pick prop names; codegen does.

---

## Failure modes (the skill handles these)

- **Vision returns nothing useful.** Write `[]`, run codegen, ship the
  flat file. Tell the user.
- **Vision returns a selector with a colon, attribute selector, or `*`.**
  Drop that decision before writing the file.
- **Vision suggests a name that isn't a valid identifier.** Codegen
  normalizes (strips non-alphanumeric, PascalCases). If still empty, falls
  back to `Item` / `Item2` / etc.
- **Two decisions claim overlapping subtrees.** Codegen processes shorter
  selectors first and skips inner matches once the outer is claimed.
- **A decision's matches differ in shape.** Codegen logs and skips that
  decision. Other decisions still process.

In every case the pipeline produces a working `<Slug>.tsx`. There is no
"abort" — the worst outcome is a flat file with a warning log.

---

## What this skill must NEVER do

- Write or edit `<Slug>.tsx` directly.
- Invent class names, text content, attribute values, or anything that
  doesn't trace back to the captured tree.
- Add commentary, descriptions, or extra fields to the decisions JSON.
- Run codegen with `--out=` to a non-canonical path.
- Skip the verifier (it runs as part of codegen; that's deliberate).

If you find yourself wanting to edit the gen'd file because "the lift
output looks weird," stop. Refine the selector or skip the decision and
let codegen produce flat-with-fewer-helpers. The data-driven invariant
is non-negotiable.
