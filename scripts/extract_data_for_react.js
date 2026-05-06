// =============================================================================
// REACT INSPECTOR — Outputs a clean component tree to the console
// with all data points needed to build React components.
// Paste into browser console and run. Change TARGET_SELECTOR if needed.
// =============================================================================

(function() {

	const TARGET_SELECTOR = 'section.section.white-brand-shapes.giftcarxd-valentine';


	// =============================================================================
	// CONFIG — which computed properties to extract (beyond defaults)
	// =============================================================================

	const PROPS_TO_EXTRACT = [
		// Layout
		'display', 'flex-direction', 'flex-wrap', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis',
		'align-items', 'align-self', 'justify-content', 'justify-self', 'gap', 'row-gap', 'column-gap',
		'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
		// Position
		'position', 'top', 'right', 'bottom', 'left', 'z-index',
		// Box model
		'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
		'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
		'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
		'box-sizing', 'overflow', 'overflow-x', 'overflow-y',
		// Border
		'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
		'border-radius', 'border-top-left-radius', 'border-top-right-radius',
		'border-bottom-left-radius', 'border-bottom-right-radius',
		'box-shadow', 'outline',
		// Typography
		'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
		'letter-spacing', 'text-align', 'text-transform', 'text-decoration',
		'white-space', 'word-break', 'color',
		// Visual
		'background-color', 'background-image', 'background-size', 'background-position',
		'background-repeat', 'opacity', 'visibility', 'cursor',
		// Transform & transition
		'transform', 'transform-origin', 'transition',
		// Sizing behavior
		'aspect-ratio', 'object-fit', 'object-position',
	];

	// Default values to skip (not worth including in output)
	const SKIP_VALUES = new Set([
		'none', 'normal', 'auto', '0px', '0', 'transparent',
		'rgba(0, 0, 0, 0)', 'initial', 'inherit', 'unset',
		'visible', 'static', 'inline', 'start', 'baseline',
		'nowrap', 'repeat', '100%', 'ease', '0s',
		'medium', 'flat', 'separate', 'clip',
	]);

	// Values to always include even if they look "default"
	const ALWAYS_INCLUDE = new Set([
		'display', 'position', 'font-family', 'font-size', 'color',
		'background-color', 'width', 'height', 'flex-direction',
	]);


	// =============================================================================
	// HELPERS — camelCase conversion, value cleanup
	// =============================================================================

	function toCamelCase(prop) {
		return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
	}

	function isSkippable(prop, value) {
		if (ALWAYS_INCLUDE.has(prop)) return false;
		if (!value || value === '') return true;
		if (SKIP_VALUES.has(value.trim())) return true;
		// Skip matrix transforms that are identity
		if (prop === 'transform' && value.includes('matrix') && value === 'matrix(1, 0, 0, 1, 0, 0)') return true;
		return false;
	}

	function getReactTag(el) {
		const tag = el.tagName.toLowerCase();
		const map = {
			'section': 'section', 'div': 'div', 'a': 'a', 'img': 'img',
			'h1': 'h1', 'h2': 'h2', 'h3': 'h3', 'h4': 'h4',
			'p': 'p', 'span': 'span', 'ul': 'ul', 'li': 'li',
			'button': 'button', 'form': 'form', 'input': 'input',
			'nav': 'nav', 'header': 'header', 'footer': 'footer',
			'main': 'main', 'article': 'article', 'svg': 'svg',
		};
		return map[tag] || tag;
	}

	function getReactProps(el) {
		const props = {};

		// Anchor props
		if (el.tagName === 'A') {
			if (el.href) props.href = el.href;
			if (el.target) props.target = el.target;
			if (el.rel) props.rel = el.rel;
		}

		// Image props
		if (el.tagName === 'IMG') {
			if (el.src) props.src = el.src.startsWith('data:') ? '[base64]' : el.src;
			if (el.alt !== undefined) props.alt = el.alt || '';
			if (el.loading) props.loading = el.loading;
			if (el.sizes) props.sizes = el.sizes;
		}

		// Input props
		if (el.tagName === 'INPUT') {
			if (el.type) props.type = el.type;
			if (el.placeholder) props.placeholder = el.placeholder;
			if (el.name) props.name = el.name;
		}

		// Cursor pointer → likely needs onClick
		const computed = window.getComputedStyle(el);
		if (computed.getPropertyValue('cursor') === 'pointer') {
			props['[onClick]'] = 'handler';
		}

		// data-* attributes (Webflow animations etc)
		for (const attr of el.attributes) {
			if (attr.name.startsWith('data-w-')) {
				props[attr.name] = attr.value;
			}
		}

		return props;
	}

	function getLeafText(el) {
		// Only return text if this element has no element children (true leaf)
		const hasElementChildren = Array.from(el.childNodes).some(n => n.nodeType === 1);
		if (hasElementChildren) return null;
		const text = el.textContent?.trim();
		return text || null;
	}

	function getStyles(el) {
		const computed = window.getComputedStyle(el);
		const styles = {};

		for (const prop of PROPS_TO_EXTRACT) {
			const value = computed.getPropertyValue(prop)?.trim();
			if (!value) continue;
			if (isSkippable(prop, value)) continue;
			styles[toCamelCase(prop)] = value;
		}

		return styles;
	}


	// =============================================================================
	// TREE BUILDER — recursively builds a plain object tree
	// =============================================================================

	function buildTree(el, depth = 0) {
		const tag = getReactTag(el);
		const classes = Array.from(el.classList);
		const styles = getStyles(el);
		const props = getReactProps(el);
		const leafText = getLeafText(el);
		const children = [];

		for (const child of el.children) {
			children.push(buildTree(child, depth + 1));
		}

		return { tag, classes, styles, props, leafText, children, depth };
	}


	// =============================================================================
	// RENDERER — prints the tree to console in a readable format
	// =============================================================================

	function renderTree(node, indent = '') {
		const { tag, classes, styles, props, leafText, children } = node;

		const classStr = classes.length ? `  .classes: [${classes.join(', ')}]` : '';
		const propsStr = Object.keys(props).length
			? `  .props:   ${JSON.stringify(props, null, 0)}`
			: '';
		const stylesStr = Object.keys(styles).length
			? `  .styles:  ${JSON.stringify(styles, null, 0)}`
			: '';
		const textStr = leafText ? `  .text:    "${leafText}"` : '';

		// Header line for the element
		console.log(`%c${indent}<${tag}>`, 'color: #7dd3fc; font-weight: bold');
		if (classStr) console.log(`%c${indent}${classStr}`, 'color: #86efac');
		if (propsStr) console.log(`%c${indent}${propsStr}`, 'color: #fbbf24');
		if (stylesStr) console.log(`%c${indent}${stylesStr}`, 'color: #e2e8f0');
		if (textStr) console.log(`%c${indent}${textStr}`, 'color: #f9a8d4');

		for (const child of children) {
			renderTree(child, indent + '  ');
		}
	}


	// =============================================================================
	// JSON EXPORT — also outputs full tree as JSON you can copy
	// =============================================================================

	function exportJSON(tree) {
		const json = JSON.stringify(tree, null, 2);
		const blob = new Blob([json], { type: 'application/json' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `react-tree-${window.innerWidth}px.json`;
		a.click();
		console.log('[inspect] ✓ JSON downloaded — import into your React workflow');
	}


	// =============================================================================
	// MAIN
	// =============================================================================

	const target = document.querySelector(TARGET_SELECTOR);
	if (!target) return console.error('[inspect] ✗ Element not found:', TARGET_SELECTOR);

	console.log(`\n%c[inspect] ━━━━ REACT COMPONENT TREE ━━━━ ${window.innerWidth}px viewport`, 'color: #a78bfa; font-weight: bold; font-size: 14px');
	console.log(`%c[inspect] Target: ${TARGET_SELECTOR}\n`, 'color: #94a3b8');

	const tree = buildTree(target);

	renderTree(tree);

	console.log(`\n%c[inspect] ━━━━ FULL JSON TREE ━━━━`, 'color: #a78bfa; font-weight: bold');
	console.log(tree); // collapsible object in devtools
	exportJSON(tree);

	console.log(`\n%c[inspect] Done. JSON also downloaded as react-tree-${window.innerWidth}px.json`, 'color: #86efac');

})();
