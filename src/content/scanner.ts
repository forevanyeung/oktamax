/**
 * Keeps view buttons in sync with the page.
 *
 * The admin console is a single-page app, so we re-scan whenever the DOM or
 * URL changes (debounced), ask every matching provider where Okta would show
 * an Edit control, and add/remove our view buttons accordingly.
 */
import type { ViewProvider, ViewTarget } from '../views/types';
import { ensureMaxBadge, findEditControl, OWN_ATTR, placeViewControl } from './dom';

interface ScannerOptions {
  providers: ViewProvider[];
  openView: (target: ViewTarget) => void;
  alwaysShow: () => boolean;
}

export function startScanner({ providers, openView, alwaysShow }: ScannerOptions) {
  // Buttons look up their target at click time, so they always use the latest scan.
  const targets = new Map<string, ViewTarget>();
  const warned = new Set<string>();

  async function scan() {
    ensureMaxBadge();
    const url = new URL(location.href);
    const seen = new Set<string>();

    for (const provider of providers.filter((p) => p.matches(url))) {
      let found: ViewTarget[];
      try {
        found = await provider.findTargets(url);
      } catch (error) {
        const message = `[oktamax] ${provider.name}: ${String(error)}`;
        if (!warned.has(message)) console.warn(message);
        warned.add(message);
        continue;
      }

      for (const target of found) {
        targets.set(target.key, target);
        const existing = document.querySelector(`[data-oktamax-key="${CSS.escape(target.key)}"]`);
        const edit = findEditControl(target.scope);
        const show = alwaysShow() || !edit;
        if (show) seen.add(target.key);

        if (show && !existing) {
          placeViewControl(target, edit, () => {
            const latest = targets.get(target.key);
            if (latest) openView(latest);
          });
        }
      }
    }

    // Remove view controls whose target disappeared or now has a real Edit button,
    // along with any actions area we added for them.
    for (const control of document.querySelectorAll<HTMLElement>('[data-oktamax-key]')) {
      if (seen.has(control.dataset.oktamaxKey ?? '')) continue;
      (control.closest(`[${OWN_ATTR}="actions"]`) ?? control).remove();
    }
  }

  // --- scheduling: debounce, and never run two scans at once ---------------
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  };

  async function run() {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await scan();
    } finally {
      running = false;
      if (pending) {
        pending = false;
        schedule();
      }
    }
  }

  const isOwnNode = (node: Node) => node instanceof Element && node.hasAttribute(OWN_ATTR);
  const isOwnMutation = (m: MutationRecord) => {
    const nodes = [...m.addedNodes, ...m.removedNodes];
    return nodes.length > 0 && nodes.every(isOwnNode);
  };

  new MutationObserver((mutations) => {
    if (!mutations.every(isOwnMutation)) schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  addEventListener('hashchange', schedule);
  addEventListener('popstate', schedule);
  schedule();

  return { rescan: schedule };
}
