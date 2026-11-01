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

/**
 * The Edit control Okta offers in this part of the page, if any. Prefers a
 * visible one, then one labelled "Edit" (menus also hold e.g. "Activate" items
 * with `data-se="edit-rule-activate"`).
 */
export function findEditControl(scope: Element): Element | undefined {
  const edits = [...scope.querySelectorAll(CONTROL)].filter(
    (el) => !isOwn(el) && isReachable(el) && looksLikeEdit(el),
  );
  return (
    edits.find(isVisible) ??
    edits.find((el) => /^edit\b/i.test(normalize(el.textContent))) ??
    edits[0]
  );
}

// 16px for menu items (Okta's icon-16 slot); 15px for buttons, near Okta's 14px edit-16 pencil.
const eyeIcon = (
  size: number,
) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  button.title = `${label} (read-only, added by Okta Max)`;
  button.setAttribute('aria-label', `${label} (read-only)`);
  button.innerHTML = eyeIcon(15);
  Object.assign(button.style, {
    display: 'inline-flex',
    // Okta's action cells can be fixed-width flex rows that would squeeze the icon away.
    flexShrink: '0',
    alignItems: 'center',
    verticalAlign: 'middle',
    margin: '0 0 0 8px',
    padding: '3px',
    border: '0',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--oktamax-accent, #1662dd)',
    cursor: 'pointer',
    lineHeight: '0',
  } satisfies Partial<CSSStyleDeclaration>);
  button.addEventListener(
    'mouseenter',
    () => (button.style.background = 'var(--oktamax-accent-hover, #ebf1fc)'),
  );
  button.addEventListener('mouseleave', () => (button.style.background = 'transparent'));
  button.addEventListener('click', (event) => {
    // Rows are often clickable/expandable; the icon should only open the dialog.
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

/** A "View" item for the "Actions" menu that `editItem` (Okta's Edit item) belongs to. */
export function createViewMenuItem(
  key: string,
  label: string,
  onClick: () => void,
  editItem: Element,
): HTMLElement {
  // Okta's own classes give the item the menu's look; drop the ones that hide or identify it.
  const item = editItem.cloneNode(false) as HTMLElement;
  item.classList.remove('option-hidden');
  item.removeAttribute('data-se');
  item.setAttribute(OWN_ATTR, 'view-button');
  item.dataset.oktamaxKey = key;
  item.title = `${label} (read-only, added by Okta Max)`;

  const link = (editItem.querySelector('a')?.cloneNode(false) as HTMLElement) ?? item;
  link.removeAttribute('data-se');
  link.innerHTML = '<p class="option-title">View</p>';
  // Okta leaves room on the left for item icons; put ours there if the menu has icons.
  if (editItem.querySelector('.icon')) {
    link.style.position = 'relative';
    link.insertAdjacentHTML(
      'afterbegin',
      `<span style="position: absolute; left: 12px; color: var(--oktamax-accent, #1662dd); line-height: 0">${eyeIcon(16)}</span>`,
    );
  }
  if (link !== item) item.append(link);

  item.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Okta closes its menus on outside clicks.
    document.body.click();
    onClick();
  });
  return item;
}

/** An element standing in for an actions area Okta didn't render; removed with its view control. */
export function createActions(tag: string, className = ''): HTMLElement {
  const actions = document.createElement(tag);
  actions.className = className;
  actions.setAttribute(OWN_ATTR, 'actions');
  return actions;
}

/** An actions cell at the end of `row`, for tables Okta renders without one for read-only admins. */
export function addActionsCell(row: Element): HTMLElement {
  const cell = createActions('td');
  row.append(cell);
  // Keep the header as wide as the rows, like the empty header Okta gives its own actions column.
  const header = row.closest('table')?.querySelector('thead tr');
  if (header && header.children.length < row.children.length) {
    header.append(createActions('th'));
  }
  return cell;
}

/**
 * Put the view control where Okta puts its Edit control: next to `edit` when
 * the page shows one (as an item of the same menu if it's in an "Actions"
 * menu), else in the object's `actions` area (next to a disabled "Actions"
 * menu if it has one, recreating the area if Okta left it out), else right
 * after the anchor text.
 */
export function placeViewControl(
  target: {
    key: string;
    title: string;
    anchor: Element;
    actions?: Element | null;
    addActions?: () => Element;
  },
  edit: Element | undefined,
  onClick: () => void,
) {
  const menuItem = edit?.closest(MENU) && edit.closest('li');
  if (menuItem) {
    menuItem.after(createViewMenuItem(target.key, target.title, onClick, menuItem));
    return;
  }

  const button = createViewButton(target.key, target.title, onClick);
  const actions = target.actions ?? (edit ? undefined : target.addActions?.());
  // Next to Okta's Edit control or (disabled) "Actions" menu, floated the same way.
  const neighbour = edit ?? actions?.querySelector(':scope > .dropdown');
  if (neighbour) {
    button.style.float = getComputedStyle(neighbour).float;
    neighbour.after(button);
  } else if (actions) {
    // Alone in the actions area: right-aligned, without leaving room for the Delete icon
    // read-only admins don't get. Works in block, table-cell and flex containers alike.
    Object.assign(button.style, { display: 'flex', width: 'fit-content', margin: '0 0 0 auto' });
    actions.append(button);
  } else {
    // Never inside a link or button.
    const interactive = target.anchor.closest('a, button, [role="button"]');
    if (interactive) interactive.after(button);
    else target.anchor.append(button);
  }
}

/** First match for `selector` in the document or any open shadow root. */
function deepQuerySelector(
  selector: string,
  root: Document | ShadowRoot = document,
): Element | null {
  const match = root.querySelector(selector);
  if (match) return match;
  for (const el of root.querySelectorAll('*')) {
    const found = el.shadowRoot && deepQuerySelector(selector, el.shadowRoot);
    if (found) return found;
  }
  return null;
}

/** Add a "MAX" label next to the Okta logo in the sidenav, so it's clear the extension is active. */
export function ensureMaxBadge() {
  // The new sidenav is rendered inside an Odyssey web component's shadow root.
  const container = deepQuerySelector('[data-se="sidenav-header-logo-container"]');
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
