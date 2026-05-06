# FONTS.md

How fonts are loaded in this project, why we use Fontsource, and how to add a new family.

---

## TL;DR

- All fonts are self-hosted via [Fontsource](https://fontsource.org/) and imported once at the root layout (`src/app/layout.tsx`).
- Captured `@font-face` rules whose family is "owned" by Fontsource are stripped out of `<slug>.css` at build time so the same font is never loaded twice.
- The Fontsource `font-family` name matches the captured CSS verbatim, so the gen'd JSX and CSS need zero rewriting.

---

## Where fonts live

`src/app/layout.tsx` — Next.js root layout. Importing a Fontsource `<weight>.css` file injects its `@font-face` rule into the document, pointing at `woff2` files bundled inside the npm package.

```ts
// src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'

// Self-hosted Google Fonts via Fontsource. Family names match captured CSS
// verbatim (e.g. font-family: Arima), so no rewriting needed.
import '@fontsource/arima/300.css'
import '@fontsource/arima/400.css'
import '@fontsource/arima/500.css'
import '@fontsource/arima/600.css'
import '@fontsource/arima/700.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
```

`package.json` pulls them in as runtime deps:

```json
"@fontsource/arima": "^5.2.8",
"@fontsource/dm-sans": "^5.2.8"
```

That's the full font wiring — there is no `next/font`, no Google Fonts `<link>`, no custom loader.

---

## Why Fontsource (and not the captured `@font-face` rules)

The source page's stylesheets contain `@font-face` URLs pointing at Webflow's CDN (`cdn.prod.website-files.com/...`). We could just emit those verbatim. We don't, for three reasons:

1. **CDN firewall.** Webflow's CDN hotlink-blocks for some asset types, can rotate filenames, or simply go away. Pulling fonts from npm isolates the clone from upstream changes.
2. **No third-party request at runtime.** Fontsource ships `woff2` inside the package. Next.js fingerprints them and serves them from the same origin — no Google Fonts CDN request, no external preconnect, no FOUC waiting on a third-party DNS.
3. **Family-name parity.** The Fontsource family name is identical to what the captured CSS uses (`font-family: Arima`, `font-family: "DM Sans"`). The gen'd JSX never needs to rewrite font names; the captured rules in `<slug>.css` resolve directly against the Fontsource `@font-face`.

---

## Picking weights

Each `import '@fontsource/<family>/<weight>.css'` injects exactly one `@font-face` for one weight. Importing weights you don't use is dead bytes; importing too few causes the browser to "synthesize" the missing weight (faux-bold), which looks wrong.

The current import list mirrors what the captured CSS actually requests:

| Family | Weights imported | Where they're used |
| --- | --- | --- |
| Arima | 300, 400, 500, 600, 700 | Display / headings |
| DM Sans | 400, 500 | Body text and UI labels |

To verify what a slug needs, grep its captured CSS for `font-weight:`:

```bash
grep -hoE 'font-weight:\s*[0-9]+' src/components/generated/<slug>.css | sort -u
```

Any weight that appears for a Fontsource family must have a matching `<weight>.css` import in `layout.tsx`.

---

## Avoiding double-loading

If we imported Fontsource AND left the captured `@font-face` rules in `<slug>.css`, the browser would download both copies. The build step prevents this.

`scripts/build-page-css.mjs` filters captured `@font-face` rules by family name:

```js
// scripts/build-page-css.mjs
const HANDLED_FAMILIES = new Set(['arima', 'dm sans', 'open sans'])
const familyOf = (faceText) => {
  const m = faceText.match(/font-family\s*:\s*['"]?([^;'"\n]+?)['"]?\s*;/i)
  return m ? m[1].trim().toLowerCase() : null
}
// ...
const kept = baseContext.fontFaces.filter((face) => {
  const fam = familyOf(face)
  return fam ? !HANDLED_FAMILIES.has(fam) : true
})
```

Any `@font-face` whose `font-family` (lowercased) is in `HANDLED_FAMILIES` is dropped before `<slug>.css` is written. Everything else (custom Webflow uploads, unusual third-party fonts) is emitted verbatim and continues to load from the source CDN.

The build log reports the count, e.g.:

```
@font-face: 0 kept, 12 dropped (handled by Fontsource)
```

`open sans` is in the set even though it isn't currently imported in `layout.tsx` — older captures included it, and keeping it on the drop-list is harmless. (If a future page actually uses Open Sans, add the `@fontsource/open-sans/<weight>.css` imports; the drop is already in place.)

---

## Adding a new Fontsource family

When a newly-cloned page uses a font we don't ship yet:

### 1. Install the package

```bash
npm install @fontsource/<family>
# e.g. npm install @fontsource/inter
```

The Fontsource family slug is the lowercased family name with spaces replaced by hyphens — `Inter` → `inter`, `DM Sans` → `dm-sans`, `Plus Jakarta Sans` → `plus-jakarta-sans`.

### 2. Find the weights the captured CSS needs

```bash
# After you've run `build:page-css` for the new page:
grep -hE 'font-family:\s*["\x27]?<Family>' src/components/generated/<slug>.css | head
grep -hoE 'font-weight:\s*[0-9]+' src/components/generated/<slug>.css | sort -u
```

(Cross-reference the rules: only weights actually used by that family need importing.)

### 3. Import each weight in `src/app/layout.tsx`

```ts
import '@fontsource/<family>/<weight>.css'
// e.g. import '@fontsource/inter/400.css'
//      import '@fontsource/inter/600.css'
```

Keep imports grouped by family and ordered by weight ascending — matches the existing style and makes the diff readable.

### 4. Add the family to `HANDLED_FAMILIES`

```js
// scripts/build-page-css.mjs
const HANDLED_FAMILIES = new Set(['arima', 'dm sans', 'open sans', '<family>'])
```

The string must be the lowercased family name **with spaces preserved** (`'dm sans'`, not `'dm-sans'`) — that's how `font-family` appears inside captured `@font-face` rules.

### 5. Rebuild affected slugs

```bash
npm run build:page-css -- --name=<slug>
# repeat per affected page
```

Verify the build log shows the captured `@font-face` rules for the new family being dropped. Open the page locally and confirm the font renders without a FOUC and without 404s in the Network tab.

---

## When NOT to use Fontsource

If a captured page uses a family that:

- Is not published on [fontsource.org](https://fontsource.org/) (custom Webflow uploads, paid foundries, brand-only fonts), **or**
- Has variable-weight or special character-set requirements not covered by the npm package,

…then leave the family OUT of `HANDLED_FAMILIES`. The captured `@font-face` rules will be emitted verbatim into `<slug>.css` and load from the source CDN. This is the fallback path; it works, but inherits all the CDN-firewall issues described above.

If the source CDN blocks hotlinking for that family, the workaround is to download the `woff2` files into `public/fonts/<family>/` and rewrite the captured `@font-face` rules' `src: url(...)` to point at the local path. That's a manual fix in `<slug>.css` — and it's one of the few cases where a hand-edit to a generated asset is acceptable, since the family isn't on Fontsource and there's no upstream pipeline change that would produce the right output automatically.

---

## File-by-file reference

| File | Role |
| --- | --- |
| `src/app/layout.tsx` | Imports `@fontsource/<family>/<weight>.css` files. The only place fonts are wired into the runtime. |
| `package.json` | Lists `@fontsource/<family>` deps. |
| `scripts/build-page-css.mjs` (`HANDLED_FAMILIES`) | Drop-list. Captured `@font-face` rules whose family is in this set are filtered out of `<slug>.css`. |
| `src/components/generated/<slug>.css` | Output of `build:page-css`. Should NOT contain `@font-face` rules for any family in `HANDLED_FAMILIES`. |
| `scrapped/<slug>-react-page-*.json` | Source of truth for what `@font-face` rules the live page declared (under `context.fontFaces`). Useful when debugging "why is this font 404-ing." |

---

## Cross-references

- README §4 *`build:page-css`* — describes the build step that consumes `HANDLED_FAMILIES`.
- README §6 *Runtime components* — overall runtime composition, of which `layout.tsx` is one piece.
- `CLAUDE.md` — project orientation; `layout.tsx` is summarized there as "Fontsource + globals."
