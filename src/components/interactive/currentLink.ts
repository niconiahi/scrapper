// Webflow tags the active page's nav links with `.w--current` and
// `aria-current="page"`. In a server-rendered clone, the link state is
// per-page, so static shared components (extracted by /extract_components)
// can't carry it. This plugin applies the markers at runtime by matching
// `<a href="…">` against `window.location.pathname`.
//
// Selector targets are limited to known nav-link classes Webflow uses for
// active-state styling — random links elsewhere on the page are left alone.

import type { Plugin } from './types'

const NAV_LINK_CLASSES = [
  'item-header',
  'secondary-nav-item',
  'footer-link',
  'brand',
  'link-block-3',
]

export const currentLinkPlugin: Plugin = {
  name: 'current-link',
  init(root) {
    const path = (typeof window !== 'undefined' ? window.location.pathname : '/') || '/'
    const normalize = (p: string) => (p === '/' ? '/' : p.replace(/\/+$/, ''))
    const here = normalize(path)

    const selector = NAV_LINK_CLASSES.map((c) => `a.${c}`).join(',')
    const links = (root as Document | HTMLElement).querySelectorAll<HTMLAnchorElement>(selector)
    const touched: HTMLAnchorElement[] = []

    for (const link of links) {
      const href = link.getAttribute('href') || ''
      // Only match relative paths; absolute URLs out of scope here (linkMap
      // already rewrote those at render time, but the rewritten value would
      // also be a path so this still applies).
      const linkPath = normalize(href.split('#')[0].split('?')[0])
      if (!linkPath.startsWith('/')) continue
      if (linkPath === here) {
        link.classList.add('w--current')
        link.setAttribute('aria-current', 'page')
        touched.push(link)
      }
    }

    return () => {
      for (const link of touched) {
        link.classList.remove('w--current')
        link.removeAttribute('aria-current')
      }
    }
  },
}
