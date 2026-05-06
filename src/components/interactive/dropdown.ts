// w-dropdown: hover/click dropdown menu.
//
// Webflow's data shape:
//   <div class="w-dropdown" data-hover="true" data-delay="0">
//     <div class="w-dropdown-toggle" aria-controls="…" aria-expanded="false">…</div>
//     <nav class="w-dropdown-list" id="…">…</nav>
//   </div>
//
// State: Webflow toggles `.w--open` on BOTH the toggle and the list, flips
// `aria-expanded`, and animates list height. We strip the captured runtime
// `style="height:0px"` on init so the list can size to its contents when
// opened — that height is closed-state leftover, not source CSS.

import type { Plugin } from './types'

export const dropdownPlugin: Plugin = {
  name: 'w-dropdown',
  init(root) {
    const cleanups: Array<() => void> = []
    const dropdowns = (root as Document | HTMLElement).querySelectorAll<HTMLElement>('.w-dropdown')

    for (const dd of dropdowns) {
      const toggle = dd.querySelector<HTMLElement>('.w-dropdown-toggle')
      const list = dd.querySelector<HTMLElement>('.w-dropdown-list')
      if (!toggle || !list) continue

      const hoverEnabled = dd.dataset.hover === 'true'
      const delay = Number(dd.dataset.delay || '0')

      list.style.removeProperty('height')

      let openTimer: ReturnType<typeof setTimeout> | null = null
      let closeTimer: ReturnType<typeof setTimeout> | null = null

      const open = () => {
        toggle.classList.add('w--open')
        list.classList.add('w--open')
        toggle.setAttribute('aria-expanded', 'true')
      }
      const close = () => {
        toggle.classList.remove('w--open')
        list.classList.remove('w--open')
        toggle.setAttribute('aria-expanded', 'false')
      }

      const onEnter = () => {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
        if (!hoverEnabled) return
        openTimer = setTimeout(open, delay)
      }
      const onLeave = () => {
        if (openTimer) { clearTimeout(openTimer); openTimer = null }
        closeTimer = setTimeout(close, delay)
      }
      const onClick = (e: MouseEvent) => {
        e.preventDefault()
        if (toggle.classList.contains('w--open')) close()
        else open()
      }
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (toggle.classList.contains('w--open')) close()
          else open()
        } else if (e.key === 'Escape') {
          close()
        }
      }
      const onDocClick = (e: MouseEvent) => {
        if (!dd.contains(e.target as Node)) close()
      }

      dd.addEventListener('mouseenter', onEnter)
      dd.addEventListener('mouseleave', onLeave)
      toggle.addEventListener('click', onClick)
      toggle.addEventListener('keydown', onKeyDown)
      document.addEventListener('click', onDocClick)

      cleanups.push(() => {
        dd.removeEventListener('mouseenter', onEnter)
        dd.removeEventListener('mouseleave', onLeave)
        toggle.removeEventListener('click', onClick)
        toggle.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('click', onDocClick)
        if (openTimer) clearTimeout(openTimer)
        if (closeTimer) clearTimeout(closeTimer)
      })
    }

    return () => cleanups.forEach((fn) => fn())
  },
}
