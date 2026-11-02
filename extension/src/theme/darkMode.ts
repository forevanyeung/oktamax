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
  'border-inline-start-color': 'border',
  'border-inline-end-color': 'border',
  'border-block-start-color': 'border',
  'border-block-end-color': 'border',
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

/**
 * Fixed overrides for the Okta shell (an Odyssey web component): the left nav
 * rail's divider gets the stronger border color, like input borders.
 */
const SHELL = `nav { border-inline-end-color: ${DARK.borderStrong} !important; }`;
const isShell = (root: Document | ShadowRoot) =>
  root instanceof ShadowRoot && root.host.localName.startsWith('odyssey-react-web-component');

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

const EVENT = 'oktamax:styles'; // dispatched by content/pageWorld.iife.ts

// Converted CSS per sheet, redone when its rule count changes (emotion inserts rules).
const converted = new WeakMap<CSSStyleSheet, { length: number; css: string }>();

function convertSheet(sheet: CSSStyleSheet, rules = sheet.cssRules): string {
  const cached = converted.get(sheet);
  if (cached?.length === rules.length) return cached.css;
  const css = convertRules(rules);
  converted.set(sheet, { length: rules.length, css });
  return css;
}

/**
 * Converted CSS of linked stylesheets by URL. Okta's CDN URLs carry a content
 * hash, so those are kept across page loads: on the next load a sheet is dark
 * before it has even downloaded, and isn't converted again.
 */
const byHref = new Map<string, string>();
const HASHED = /[.-][0-9a-f]{8,}\.css$|\/\d+\.\d+\.\d+\//;
const STORAGE_KEY = 'darkModeCss';
// A hash of this code, set in vite.config.ts; empty in dev, where nothing is kept.
// CRXJS's dev build of `.iife.ts` scripts skips `define`, leaving it undeclared there.
declare const __THEME_CACHE_KEY__: string | undefined;
const CACHE_KEY = typeof __THEME_CACHE_KEY__ === 'string' ? __THEME_CACHE_KEY__ : '';

// When each sheet was last on a page. Every Okta release brings new hashed URLs, so
// sheets unused for a while are dropped; otherwise the cache outgrows storage's quota.
const usedAt = new Map<string, number>();
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 14 * DAY_MS;
const isFresh = (href: string) => Date.now() - (usedAt.get(href) ?? 0) < MAX_AGE_MS;

function markUsed(href: string) {
  const last = usedAt.get(href);
  usedAt.set(href, Date.now());
  // Saved about daily for sheets that are still in use, so they don't age out.
  if (last !== undefined && Date.now() - last > DAY_MS) save();
}

interface SavedCss {
  build: string;
  css: Record<string, string>;
  used?: Record<string, number>;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  if (!CACHE_KEY) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Reloading the extension leaves this script running without access to storage.
    if (!chrome.runtime?.id) return;
    const hrefs = [...byHref.keys()].filter((href) => HASHED.test(href) && isFresh(href));
    const saved: SavedCss = {
      build: CACHE_KEY,
      css: Object.fromEntries(hrefs.map((href) => [href, byHref.get(href)!])),
      used: Object.fromEntries(hrefs.map((href) => [href, usedAt.get(href)!])),
    };
    chrome.storage.local.set({ [STORAGE_KEY]: saved }).catch(() => {});
  }, 2000);
}

const restored = chrome.storage.local.get(STORAGE_KEY).then((items) => {
  const saved = items[STORAGE_KEY] as SavedCss | undefined;
  if (!CACHE_KEY || saved?.build !== CACHE_KEY) return;
  for (const [href, css] of Object.entries(saved.css)) {
    if (byHref.has(href)) continue;
    byHref.set(href, css);
    if (!usedAt.has(href)) usedAt.set(href, saved.used?.[href] ?? Date.now());
  }
});

// Sheets the CSSOM won't expose (cross-origin, no `crossorigin` attribute) are fetched.
const fetching = new Set<string>();
function fetchSheet(href: string, onDone: () => void) {
  if (fetching.has(href)) return;
  fetching.add(href);
  fetch(href)
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
    .then((text) => {
      const parsed = new CSSStyleSheet();
      parsed.replaceSync(text);
      byHref.set(href, convertRules(parsed.cssRules));
      save();
      onDone();
    })
    .catch(() => {});
}

type StyleOwner = HTMLLinkElement | HTMLStyleElement | SVGStyleElement;

function ownerCss(owner: StyleOwner, onFetched: () => void): string {
  const href = owner instanceof HTMLLinkElement ? owner.href : '';
  const sheet = owner.sheet as CSSStyleSheet | null;
  if (href) markUsed(href);
  let css = '';
  if (href && HASHED.test(href) && byHref.has(href)) css = byHref.get(href)!;
  else if (sheet) {
    let rules: CSSRuleList | undefined;
    try {
      rules = sheet.cssRules;
    } catch {
      if (href) fetchSheet(href, onFetched);
    }
    if (rules) {
      css = convertSheet(sheet, rules);
      if (href && byHref.get(href) !== css) {
        byHref.set(href, css);
        save();
      }
    } else css = byHref.get(href) ?? '';
  } else css = byHref.get(href) ?? ''; // still downloading
  const media = owner.getAttribute('media');
  return css && media && media !== 'all' ? `@media ${media}{${css}}` : css;
}

/** The sheet content/pageWorld.iife.ts adopts to keep the page dark until we're ready. */
const isEarlyDark = (sheet: CSSStyleSheet) =>
  (sheet.cssRules[0] as CSSStyleRule | undefined)?.style?.getPropertyValue(
    '--oktamax-early-dark',
  ) === '1';

/** Shows the page content/pageWorld.iife.ts hid, if it did. */
export function removeEarlyDark() {
  const sheets = document.adoptedStyleSheets;
  if (sheets.some(isEarlyDark)) document.adoptedStyleSheets = sheets.filter((s) => !isEarlyDark(s));
}

interface ThemedRoot {
  root: Document | ShadowRoot;
  /** Our dark copy of each of the root's sheets, by owner element or adopted sheet. */
  mirrors: Map<object, { sheet: CSSStyleSheet; css: string }>;
  /** The root's <link>/<style> elements; re-queried after its children change. */
  owners?: StyleOwner[];
  attributesCss: string;
  attributesDirty: boolean;
  onLoad: () => void;
}

const ATTRIBUTES = {};
const FIXED = {};

export interface DarkMode {
  stop(): void;
}

export function startDarkMode(): DarkMode {
  const roots = new Map<Document | ShadowRoot, ThemedRoot>();
  const ownSheets = new WeakSet<CSSStyleSheet>();

  const update = (themed: ThemedRoot) => {
    const { root, mirrors } = themed;
    const ours: CSSStyleSheet[] = [];
    const seen = new Set<object>();
    const add = (key: object, css: string) => {
      if (!css) return;
      seen.add(key);
      let mirror = mirrors.get(key);
      if (!mirror) {
        mirror = { sheet: new CSSStyleSheet(), css: '' };
        ownSheets.add(mirror.sheet);
        mirrors.set(key, mirror);
      }
      if (mirror.css !== css) {
        mirror.sheet.replaceSync(css);
        mirror.css = css;
      }
      ours.push(mirror.sheet);
    };

    themed.owners ??= [
      ...root.querySelectorAll<StyleOwner>('link[rel~="stylesheet" i], style'),
    ].filter((owner) => !owner.hasAttribute(OWN_ATTR));
    for (const owner of themed.owners)
      add(
        owner,
        ownerCss(owner, () => schedule()),
      );
    const pageAdopted = root.adoptedStyleSheets.filter((s) => !ownSheets.has(s));
    const early = pageAdopted.filter(isEarlyDark);
    for (const sheet of pageAdopted) if (!early.includes(sheet)) add(sheet, convertSheet(sheet));
    if (themed.attributesDirty) {
      themed.attributesCss = convertAttributes(root);
      themed.attributesDirty = false;
    }
    add(ATTRIBUTES, themed.attributesCss);
    if (root instanceof Document) add(FIXED, BASE);
    else if (isShell(root)) add(FIXED, SHELL);
    for (const key of mirrors.keys()) if (!seen.has(key)) mirrors.delete(key);

    // Ours go last, after any sheets the page adopts itself.
    const next = [...pageAdopted.filter((s) => !early.includes(s)), ...ours, ...early];
    const current = root.adoptedStyleSheets;
    if (next.length !== current.length || next.some((s, i) => s !== current[i])) {
      root.adoptedStyleSheets = next;
    }
  };

  const themedRoot = (node: Node) => roots.get(node.getRootNode() as Document | ShadowRoot);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const themed = themedRoot(record.target);
      if (record.type === 'childList') {
        for (const node of record.addedNodes) if (node instanceof Element) addShadowRoots(node);
        if (themed) themed.owners = undefined;
      }
      if (themed && record.type !== 'characterData') themed.attributesDirty = true;
      if (themed) schedule(themed);
    }
  });

  const addRoot = (root: Document | ShadowRoot) => {
    if (roots.has(root)) return;
    const themed: ThemedRoot = {
      root,
      mirrors: new Map(),
      attributesCss: '',
      attributesDirty: true,
      // Stylesheets finishing their download don't mutate the DOM.
      onLoad: () => schedule(themed),
    };
    roots.set(root, themed);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributeFilter: ['style', 'fill', 'stroke'],
    });
    root.addEventListener('load', themed.onLoad, true);
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

  // Updates run as a microtask: after the page's script has added its rules or
  // elements, but before the browser renders them. Only roots that changed are
  // updated; the Okta shell alone has several, and emotion inserts rules often.
  const dirty = new Set<ThemedRoot>();
  const flush = () => {
    for (const themed of dirty) {
      const { root } = themed;
      if (root instanceof ShadowRoot && !root.host.isConnected) roots.delete(root);
      else if (roots.has(root)) update(themed);
    }
    dirty.clear();
  };
  function schedule(themed?: ThemedRoot) {
    if (!dirty.size) queueMicrotask(flush);
    for (const t of themed ? [themed] : roots.values()) dirty.add(t);
  }

  const onStyles = (event: Event) => {
    const target = event.composedPath()[0];
    if (!(target instanceof Node)) return schedule();
    // A shadow host: its root attached a shadow root or adopted sheets.
    if (target instanceof Element && target.shadowRoot && !target.hasAttribute(OWN_ATTR)) {
      addRoot(target.shadowRoot);
      schedule(roots.get(target.shadowRoot));
    }
    const root = target.getRootNode();
    if (root instanceof ShadowRoot && !root.host.hasAttribute(OWN_ATTR)) addRoot(root);
    const themed = themedRoot(target);
    if (themed) schedule(themed);
  };
  document.addEventListener(EVENT, onStyles, true);

  addRoot(document);
  addShadowRoots(document.documentElement);
  // Once the CSS converted on earlier page loads is back, the page is dark: show it.
  void restored.finally(() => {
    schedule();
    flush();
    removeEarlyDark();
  });
  // A safety net for anything the events above miss (closed-over sheet APIs, late upgrades).
  const timer = setInterval(() => {
    addShadowRoots(document.documentElement);
    schedule();
  }, 2000);

  return {
    stop() {
      clearInterval(timer);
      observer.disconnect();
      document.removeEventListener(EVENT, onStyles, true);
      for (const { root, onLoad } of roots.values()) {
        root.removeEventListener('load', onLoad, true);
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => !ownSheets.has(s));
      }
      roots.clear();
      dirty.clear();
      removeEarlyDark();
    },
  };
}
