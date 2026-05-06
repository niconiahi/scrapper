'use client'

import { useEffect } from 'react'
import { PageRenderer } from '@/components/generated/PageRenderer'

export default function ClonePage() {
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
    // Defer observe by two frames so the browser paints the initial
    // [data-anim] (opacity:0) state before the observer flips elements
    // already in the viewport to .is-visible. Without this, transitions
    // skip because both states land in the same paint.
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

  return <PageRenderer />
}
