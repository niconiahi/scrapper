// Plugin registry — `PageInteractive` iterates this.
//
// Adding a Webflow component runtime: drop a new module in this directory,
// import it here, append to PLUGINS. Each plugin is independent.
import type { Plugin } from './types'
import { dropdownPlugin } from './dropdown'
import { tabsPlugin } from './tabs'
import { currentLinkPlugin } from './currentLink'

export const PLUGINS: Plugin[] = [
  dropdownPlugin,
  tabsPlugin,
  currentLinkPlugin,
]

export type { Plugin }
