'use client'

import { useEffect } from 'react'
import { PLUGINS } from './interactive'

// Wires up Webflow-component behaviors that are normally provided by the
// shipped `webflow.js` runtime. We don't ship that runtime, so we
// reimplement the small surface area we need via a plugin registry.
//
// Each plugin (see src/components/interactive/) handles one component
// (w-dropdown, w-tabs, w-nav, …). Plugin shape: { name, init: (root) =>
// cleanup }. PageInteractive runs them on mount, runs their cleanups on
// unmount.
export function PageInteractive() {
  useEffect(() => {
    const cleanups = PLUGINS.map((p) => p.init(document))
    return () => cleanups.forEach((fn) => fn())
  }, [])

  return null
}
