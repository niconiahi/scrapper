'use client'

import { useEffect, type ReactNode } from 'react'

// Mounts an IntersectionObserver that adds `is-visible` to every
// `[data-anim]` element when it enters the viewport. Generated per-page
// route files wrap their <PageRenderer/> in this so the IX2 reveal CSS
// fires once per element (one-shot via `unobserve`).
//
// Double rAF: the observer can fire synchronously on observe() for elements
// already in the viewport. Without deferring two frames, the initial CSS
// state (opacity:0) and `.is-visible` land in the same paint and the
// transition is skipped — header / hero would never animate.
export function PageReveal({ children }: { children: ReactNode }) {
  useEffect(() => {
    const targets = document.querySelectorAll<HTMLElement>('[data-anim]')
    if (!targets.length) return
    if (!('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-visible'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-visible')
          io.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.01 },
    )
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        targets.forEach((el) => io.observe(el))
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      io.disconnect()
    }
  }, [])

  return <>{children}</>
}
