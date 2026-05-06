// A plugin is a closed unit of Webflow-component behavior. The runtime
// (PageInteractive) iterates the registered plugins, each one queries the
// DOM for elements it cares about, attaches listeners / mutates state
// classes, and returns a cleanup that's run on unmount.
//
// Why this shape instead of one big useEffect: Webflow has ~7 component
// runtimes (dropdown, nav, tabs, slider, lightbox, form, background-video)
// plus IX2. Each is independent; coupling them in one effect makes adding
// the next one a merge-conflict + cognitive load every time. Plugins are
// addressable, deletable, and testable in isolation.
export type Plugin = {
  name: string
  init: (root: ParentNode) => () => void
}
