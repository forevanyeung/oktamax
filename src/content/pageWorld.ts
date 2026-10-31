/**
 * Runs in the page's own JS world at document_start, synchronously: unlike
 * the isolated-world scripts, it isn't loaded through an async `import()`, so
 * it runs before the console's first paint.
 *
 * Self-contained on purpose: main-world scripts can't import extension chunks.
 */

// 1. If the console was dark last time, keep it dark until dark mode has
// darkened the page's stylesheets: a dark canvas, with the page hidden for a
// moment instead of flashing light. Dark mode removes this; the animation shows
// the page anyway if it never does.
// A constructed sheet: Okta's CSP blocks <style> elements without its nonce.
if (localStorage.getItem('oktamax-dark') === '1') {
  const early = new CSSStyleSheet();
  early.replaceSync(`
    :root { --oktamax-early-dark: 1; color-scheme: dark; background: #131417 !important; }
    body { visibility: hidden; animation: oktamax-reveal 0s 1.5s forwards; }
    @keyframes oktamax-reveal { to { visibility: visible; } }
  `);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, early];
}

// 2. Emotion adds its rules with `insertRule`, and Odyssey components attach
// shadow roots; neither shows up as a DOM mutation. Announce both so dark mode
// (in the extension's isolated world) can darken them before the next paint.
const EVENT = 'oktamax:styles'; // also in theme/darkMode.ts

const notify = (target: Node | null | undefined) =>
  (target?.isConnected ? target : document).dispatchEvent(
    new Event(EVENT, { bubbles: true, composed: true }),
  );

function after<T extends object, K extends keyof T>(
  proto: T,
  name: K,
  target: (self: T) => Node | null | undefined,
) {
  const original = proto[name] as (...args: unknown[]) => unknown;
  Object.defineProperty(proto, name, {
    configurable: true,
    writable: true,
    value: function (this: T, ...args: unknown[]) {
      const result = original.apply(this, args);
      notify(target(this));
      return result;
    },
  });
}

const sheetOwner = (sheet: CSSStyleSheet) => sheet.ownerNode;
after(CSSStyleSheet.prototype, 'insertRule', sheetOwner);
after(CSSStyleSheet.prototype, 'deleteRule', sheetOwner);
after(CSSStyleSheet.prototype, 'replaceSync', sheetOwner);
after(Element.prototype, 'attachShadow', (el) => el);

for (const proto of [Document.prototype, ShadowRoot.prototype]) {
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'adoptedStyleSheets');
  if (!descriptor?.set) continue;
  Object.defineProperty(proto, 'adoptedStyleSheets', {
    ...descriptor,
    set(this: Document | ShadowRoot, sheets: CSSStyleSheet[]) {
      descriptor.set!.call(this, sheets);
      notify(this instanceof ShadowRoot ? this.host : this);
    },
  });
}
