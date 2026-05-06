// w-tabs: tab switcher.
//
// Webflow's data shape:
//   <div class="w-tabs">
//     <div class="w-tab-menu">
//       <a class="w-tab-link" href="#Brunch" aria-controls="Brunch"
//          aria-selected="true|false" data-w-tab="Brunch">…</a>
//       <a class="w-tab-link" …>…</a>
//     </div>
//     <div class="w-tab-content">
//       <div class="w-tab-pane" id="Brunch" data-target="Brunch"
//            role="tabpanel">…</div>
//     </div>
//   </div>
//
// State: the active link has `.w--current` + `aria-selected="true"`; the
// active pane has `.w--tab-active`. Captured CSS already styles both.
// Pane↔link match is by `aria-controls` (link) → `id` (pane).

import type { Plugin } from './types'

export const tabsPlugin: Plugin = {
  name: 'w-tabs',
  init(root) {
    const cleanups: Array<() => void> = []
    const groups = (root as Document | HTMLElement).querySelectorAll<HTMLElement>('.w-tabs')

    for (const group of groups) {
      const links = Array.from(group.querySelectorAll<HTMLAnchorElement>('.w-tab-link'))
      const panes = Array.from(group.querySelectorAll<HTMLElement>('.w-tab-pane'))
      if (!links.length || !panes.length) continue

      const select = (selectedLink: HTMLAnchorElement) => {
        const targetId = selectedLink.getAttribute('aria-controls') ||
                         selectedLink.getAttribute('data-w-tab')
        for (const link of links) {
          const isActive = link === selectedLink
          link.classList.toggle('w--current', isActive)
          link.setAttribute('aria-selected', isActive ? 'true' : 'false')
          link.setAttribute('tabindex', isActive ? '0' : '-1')
        }
        for (const pane of panes) {
          // Match by id (preferred) or by data-target. Webflow sets both.
          const isActive = (targetId && (pane.id === targetId || pane.dataset.target === targetId))
          pane.classList.toggle('w--tab-active', !!isActive)
        }
      }

      const handlers: Array<[HTMLAnchorElement, (e: Event) => void, (e: KeyboardEvent) => void]> = []
      for (const link of links) {
        const onClick = (e: Event) => {
          e.preventDefault()  // links use href="#anchor" — don't push URL fragment
          select(link)
        }
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            const idx = links.indexOf(link)
            const next = e.key === 'ArrowLeft'
              ? links[(idx - 1 + links.length) % links.length]
              : links[(idx + 1) % links.length]
            next.focus()
            select(next)
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            select(link)
          }
        }
        link.addEventListener('click', onClick)
        link.addEventListener('keydown', onKey)
        handlers.push([link, onClick, onKey])
      }

      cleanups.push(() => {
        for (const [link, onClick, onKey] of handlers) {
          link.removeEventListener('click', onClick)
          link.removeEventListener('keydown', onKey)
        }
      })
    }

    return () => cleanups.forEach((fn) => fn())
  },
}
