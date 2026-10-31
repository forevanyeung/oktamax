/**
 * Dark mode for the admin console. Okta's markup mixes Odyssey (MUI + emotion),
 * the legacy Courage CSS and CSS modules, and the nav shell lives in shadow
 * roots, so rather than restyling each widget this reads every stylesheet the
 * page has (in the document and in each open shadow root), rewrites the colors
 * of each rule with `darkenValue`, and adopts the result after the page's own
 * sheets. Same selectors, same order, later in the cascade: the dark color wins
 * exactly where the light one applied.
 */
import { OWN_ATTR } from '../content/dom';
import { DARK, darkenValue, parseColor, type Role } from './palette';

const ROLES: Record<string, Role> = {
  color: 'text',
  fill: 'text',
  stroke: 'text',
  'caret-color': 'text',
  'text-decoration-color': 'text',
  '-webkit-text-fill-color': 'text',
  'background-color': 'background',
  'background-image': 'background',
  'border-top-color': 'border',
  'border-right-color': 'border',
  'border-bottom-color': 'border',
  'border-left-color': 'border',
  'outline-color': 'border',
  'column-rule-color': 'border',
  'box-shadow': 'shadow',
  'text-shadow': 'shadow',
};

/** Custom properties holding colors, guessed by name. */
const customRole = (name: string): Role =>
  /background|bg|surface|fill/i.test(name)
    ? 'background'
    : /border|divider|outline/i.test(name)
      ? 'border'
      : /shadow/i.test(name)
        ? 'shadow'
        : 'text';

/** Fixed overrides on top of the generated ones. */
const BASE = `
:root {
  color-scheme: dark;
  --okta-app-theme-background-color: ${DARK.canvas};
  --okta-app-theme-surface-color: ${DARK.surface};
  --oktamax-accent: ${DARK.link};
  --oktamax-accent-hover: ${DARK.primaryTint};
}
html, body { background-color: ${DARK.canvas}; }
`;

/**
 * Page-level layout (`body`, the shell's full-height grid and its regions)
 * paints the app's gray background, which is darker than cards in dark mode,
 * while the same gray on a chip or table header is lighter than its card.
 */
const isCanvas = ({ selectorText, style }: CSSStyleRule) =>
  /(^|,\s*)(html|body)\b/.test(selectorText) ||
  /\b100d?vh\b/.test(style.height + style.minHeight) ||
  /\b(app-content|top-nav)\b/.test(style.gridArea);

function declarations(rule: CSSStyleRule): string {
  const { style } = rule;
  let out = '';
  for (let i = 0; i < style.length; i++) {
    const prop = style[i]!;
    const role = ROLES[prop] ?? (prop.startsWith('--') ? customRole(prop) : undefined);
    if (!role) continue;
    const value = style.getPropertyValue(prop);
    const dark =
      prop === 'background-color' && isCanvas(rule) && parseColor(value)?.[3] === 1
        ? DARK.canvas
        : darkenValue(value, role);
    // Unchanged colors (transparent, inherit) are kept too, so a later page rule that
    // resets a color still beats an earlier one we darkened. Not images: their
    // relative url()s would resolve against the page instead of the stylesheet.
    if (!value || (dark === value && (prop.startsWith('--') || prop === 'background-image')))
      continue;
    const important = style.getPropertyPriority(prop) ? ' !important' : '';
    out += `${prop}:${dark}${important};`;
  }
  return out;
}

function convertRules(rules: CSSRuleList): string {
  let out = '';
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const own = declarations(rule);
      const nested = rule.cssRules?.length ? convertRules(rule.cssRules) : '';
      if (own || nested) out += `${rule.selectorText}{${own}${nested}}`;
    } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      const inner = convertRules(rule.cssRules);
      if (inner)
        out += `@${rule instanceof CSSMediaRule ? 'media' : 'supports'} ${rule.conditionText}{${inner}}`;
    } else if (rule instanceof CSSContainerRule) {
      const inner = convertRules(rule.cssRules);
      if (inner) out += `@container ${rule.conditionText}{${inner}}`;
    } else if (rule instanceof CSSLayerBlockRule) {
      const inner = convertRules(rule.cssRules);
      if (inner) out += `@layer ${rule.name}{${inner}}`;
    }
  }
  return out;
}

const INLINE_COLOR =
  /(?:^|;)\s*((color|fill|stroke|background-color|background)\s*:\s*([^;!]+?))\s*(?=;|!|$)/gi;
const cssString = (s: string) => JSON.stringify(s);

/**
 * SVG `fill`/`stroke` attributes (icons, the Okta logo, charts) and inline
 * `style` colors don't come from stylesheets, so match them by value.
 */
function convertAttributes(root: Document | ShadowRoot): string {
  const rules = new Set<string>();
  const elements = root.querySelectorAll(
    '[fill], [stroke], [style*="color"], [style*="fill"], [style*="stroke"], [style*="background"]',
  );
  for (const el of elements) {
    if (el.closest(`[${OWN_ATTR}]`)) continue;
    for (const attr of ['fill', 'stroke'] as const) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      // Chart and icon backdrops are rects; everything else is foreground.
      const role: Role =
        attr === 'stroke' ? 'border' : el.tagName === 'rect' ? 'background' : 'text';
      const dark = darkenValue(value, role);
      const tag = attr === 'fill' && el.tagName === 'rect' ? 'rect' : '';
      if (dark !== value)
        rules.add(`${tag}[${attr}=${cssString(value)}]${tag ? '' : ':not(rect)'}{${attr}:${dark}}`);
    }
    for (const [, declaration, prop, value] of el.getAttribute('style')?.matchAll(INLINE_COLOR) ??
      []) {
      const role = ROLES[prop!.toLowerCase()] ?? 'background';
      const dark = darkenValue(value!, role);
      if (dark === value) continue;
      const selector = [
        `[style^=${cssString(declaration!)}]`,
        `[style*=${cssString('; ' + declaration)}]`,
        `[style*=${cssString(';' + declaration)}]`,
      ];
      rules.add(
        `:is(${selector.join(',')}){${prop === 'background' ? 'background-color' : prop}:${dark} !important}`,
      );
    }
  }
  return [...rules].join('');
}

// Converted CSS per sheet, redone when its rule count changes (emotion inserts rules).
const converted = new WeakMap<CSSStyleSheet, { length: number; css: string }>();

// Sheets the CSSOM won't expose (cross-origin, no `crossorigin` attribute), fetched and parsed.
const fetched = new Map<string, CSSStyleSheet | 'pending' | 'failed'>();

function readRules(sheet: CSSStyleSheet, onFetched: () => void): CSSRuleList | undefined {
  try {
    return sheet.cssRules;
  } catch {
    const href = sheet.href;
    if (!href) return undefined;
    const copy = fetched.get(href);
    if (copy instanceof CSSStyleSheet) return copy.cssRules;
    if (!copy) {
      fetched.set(href, 'pending');
      fetch(href)
        .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
        .then((text) => {
          const parsed = new CSSStyleSheet();
          parsed.replaceSync(text);
          fetched.set(href, parsed);
          onFetched();
        })
        .catch(() => fetched.set(href, 'failed'));
    }
    return undefined;
  }
}

function convertSheet(sheet: CSSStyleSheet, onFetched: () => void): string {
  const rules = readRules(sheet, onFetched);
  if (!rules) return '';
  const cached = converted.get(sheet);
  if (cached?.length === rules.length) return cached.css;
  const css = convertRules(rules);
  converted.set(sheet, { length: rules.length, css });
  return css;
}

interface ThemedRoot {
  root: Document | ShadowRoot;
  sheet: CSSStyleSheet;
  css: string;
}

export interface DarkMode {
  stop(): void;
}

export function startDarkMode(): DarkMode {
  const roots = new Map<Document | ShadowRoot, ThemedRoot>();
  const ownSheets = new WeakSet<CSSStyleSheet>();

  const update = (themed: ThemedRoot) => {
    const { root, sheet } = themed;
    let css = '';
    for (const s of root.styleSheets) css += convertSheet(s, schedule);
    for (const s of root.adoptedStyleSheets)
      if (!ownSheets.has(s)) css += convertSheet(s, schedule);
    css += convertAttributes(root);
    if (root instanceof Document) css += BASE;
    if (css !== themed.css) {
      sheet.replaceSync(css);
      themed.css = css;
    }
    // Stay last, even if the page adopts sheets of its own later.
    const adopted = root.adoptedStyleSheets;
    if (adopted[adopted.length - 1] !== sheet) {
      root.adoptedStyleSheets = [...adopted.filter((s) => s !== sheet), sheet];
    }
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) addShadowRoots(node);
    }
    schedule();
  });

  const addRoot = (root: Document | ShadowRoot) => {
    if (roots.has(root)) return;
    const sheet = new CSSStyleSheet();
    ownSheets.add(sheet);
    const themed = { root, sheet, css: '' };
    roots.set(root, themed);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    update(themed);
    if (root instanceof ShadowRoot) addShadowRoots(root);
  };

  function addShadowRoots(scope: Element | ShadowRoot) {
    const elements =
      scope instanceof Element
        ? [scope, ...scope.querySelectorAll('*')]
        : scope.querySelectorAll('*');
    for (const el of elements) {
      // Our own dialog has its own dark styles.
      if (el.shadowRoot && !el.hasAttribute(OWN_ATTR)) addRoot(el.shadowRoot);
    }
  }

  let pending = 0;
  function schedule() {
    pending ||= requestAnimationFrame(() => {
      pending = 0;
      for (const [root, themed] of roots) {
        if (root instanceof ShadowRoot && !root.host.isConnected) roots.delete(root);
        else update(themed);
      }
    });
  }

  addRoot(document);
  addShadowRoots(document.documentElement);
  // Emotion's insertRule and late shadow roots don't always show up as mutations.
  const timer = setInterval(() => {
    addShadowRoots(document.documentElement);
    schedule();
  }, 1000);

  return {
    stop() {
      clearInterval(timer);
      cancelAnimationFrame(pending);
      observer.disconnect();
      for (const { root, sheet } of roots.values()) {
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
      }
      roots.clear();
    },
  };
}
