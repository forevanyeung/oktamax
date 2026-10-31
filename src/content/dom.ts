/**
 * Finding things on the admin console page.
 *
 * Okta's markup differs between its legacy (Backbone) and new (React) pages
 * and changes often, so nothing here relies on Okta's CSS classes. Instead we
 * locate sections by their heading text and rows by the object names the API
 * returned, then look for an "Edit" control near them.
 */

/** Marks every element this extension adds to the page. */
export const OWN_ATTR = 'data-oktamax';

const HEADING = 'h1, h2, h3, h4, h5, h6, legend, [role="heading"]';
const ROW = 'tr, [role="row"], li';
const CONTROL =
  'button, a, [role="button"], [role="menuitem"], input[type="button"], input[type="submit"]';

const normalize = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export const isVisible = (el: Element) => el.getClientRects().length > 0;

const isOwn = (el: Element) => el.closest(`[${OWN_ATTR}]`) !== null;

/** Map of visible text -> innermost elements containing exactly that text. */
export function textIndex(root: Node = document.body): Map<string, Element[]> {
  const index = new Map<string, Element[]>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = normalize(node.nodeValue);
    const el = node.parentElement;
    if (!text || text.length > 200 || !el) continue;
    if (el.closest('script, style, noscript, template') || isOwn(el) || !isVisible(el)) continue;
    index.set(text, [...(index.get(text) ?? []), el]);
  }
  return index;
}

/**
 * Grow from `anchor` towards the root for as long as we don't swallow any of
 * `others` (other sections' headings / other rows' names). The result is the
 * part of the page that belongs to this anchor only.
 */
export function scopeOf(anchor: Element, others: Element[]): Element {
  const row = anchor.closest(ROW);
  if (row) return row;

  const foreign = others.filter((o) => !o.contains(anchor) && !anchor.contains(o));
  let scope = anchor;
  for (let depth = 0; depth < 8; depth++) {
    const parent = scope.parentElement;
    if (!parent || parent === document.body || foreign.some((o) => parent.contains(o))) break;
    scope = parent;
  }
  return scope;
}

/** Visible section headings with one of the given titles, plus the section they head. */
export function findSections(
  titles: string[],
): Array<{ title: string; anchor: Element; scope: Element }> {
  const headings = [...document.querySelectorAll(HEADING)].filter(isVisible);
  const index = textIndex();

  return titles.flatMap((title) => {
    const anchor = index.get(title)?.find((el) => el.closest(HEADING));
    return anchor ? [{ title, anchor, scope: scopeOf(anchor, headings) }] : [];
  });
}

/** The visible section heading texts, used to work out which policy/app is selected. */
export const headingTexts = () =>
  [...document.querySelectorAll(HEADING)].filter(isVisible).map((h) => normalize(h.textContent));

/**
 * Find each API object on the page by its name (rule rows, zone rows, ...).
 * `nameOf` may list several names when the console labels an object
 * differently from the API; the first one on the page wins. Objects with
 * identical names are matched to on-page occurrences in order.
 */
export function findItems<T>(
  items: T[],
  nameOf: (item: T) => string | string[],
): Array<{ item: T; anchor: Element; scope: Element }> {
  const index = textIndex();
  const used = new Map<string, number>();
  const found = items.flatMap((item) => {
    const names = [nameOf(item)].flat().map(normalize);
    const name = names.find((n) => index.has(n)) ?? names[0]!;
    const n = used.get(name) ?? 0;
    used.set(name, n + 1);
    const anchor = index.get(name)?.[n];
    return anchor ? [{ item, anchor }] : [];
  });

  const anchors = found.map((f) => f.anchor);
  return found.map((f) => ({ ...f, scope: scopeOf(f.anchor, anchors) }));
}

const looksLikeEdit = (el: Element) => {
  const text = normalize(el.textContent);
  const attrs = ['aria-label', 'title', 'data-se'].map((a) => el.getAttribute(a) ?? '').join(' ');
  return (
    (text.length < 30 && /^edit\b/i.test(text)) ||
    /\bedit\b/i.test(attrs) ||
    /\bicon-edit\b|\bedit-button\b/.test(el.getAttribute('class') ?? '')
  );
};

// Collapsed "Actions ▾" menus keep their items in the DOM but hidden.
const MENU = '.dropdown, .okta-dropdown-list, [role="menu"]';

/** Visible, or an item of an "Actions" menu whose toggle is visible. */
const isReachable = (el: Element) => {
  if (isVisible(el)) return true;
  const menu = el.closest(MENU);
  return menu !== null && isVisible(menu.closest('.dropdown') ?? menu);
};

/** Does Okta already offer an Edit control in this part of the page? */
export const hasEditControl = (scope: Element) =>
  [...scope.querySelectorAll(CONTROL)].some(
    (el) => !isOwn(el) && isReachable(el) && looksLikeEdit(el),
  );

const EYE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="2"/>
</svg>`;

export function createViewButton(
  key: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute(OWN_ATTR, 'view-button');
  button.dataset.oktamaxKey = key;
  button.title = `${label} (read-only)`;
  button.setAttribute('aria-label', button.title);
  button.innerHTML = EYE_ICON;
  Object.assign(button.style, {
    display: 'inline-flex',
    alignItems: 'center',
    verticalAlign: 'middle',
    margin: '0 0 0 8px',
    padding: '4px',
    border: '0',
    borderRadius: '4px',
    background: 'transparent',
    color: '#1662dd',
    cursor: 'pointer',
    lineHeight: '0',
  } satisfies Partial<CSSStyleDeclaration>);
  button.addEventListener('mouseenter', () => (button.style.background = '#ebf1fc'));
  button.addEventListener('mouseleave', () => (button.style.background = 'transparent'));
  button.addEventListener('click', (event) => {
    // Rows are often clickable/expandable; the icon should only open the dialog.
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

/** Put the button right after the anchor text – but never inside a link or button. */
export function insertAfterAnchor(anchor: Element, button: HTMLElement) {
  const interactive = anchor.closest('a, button, [role="button"]');
  if (interactive) interactive.after(button);
  else anchor.append(button);
}

/** Add a "MAX" label next to the Okta logo in the sidenav, so it's clear the extension is active. */
export function ensureMaxBadge() {
  const container = document.querySelector('.sidenav-header-logo-container');
  if (!container || container.querySelector(`[${OWN_ATTR}="max-badge"]`)) return;

  const badge = document.createElement('span');
  badge.setAttribute(OWN_ATTR, 'max-badge');
  badge.textContent = 'MAX';
  badge.title = 'Okta Max is active';
  Object.assign(badge.style, {
    display: 'inline-block',
    alignSelf: 'center',
    marginLeft: '8px',
    padding: '2px 6px',
    borderRadius: '4px',
    background: '#1662dd',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '700',
    letterSpacing: '0.08em',
    lineHeight: '1.4',
    verticalAlign: 'middle',
  } satisfies Partial<CSSStyleDeclaration>);
  container.append(badge);
}
