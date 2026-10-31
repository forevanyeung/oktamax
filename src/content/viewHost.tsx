/**
 * Mounts a React + Odyssey root inside a shadow DOM, so Okta's page CSS and
 * ours can't affect each other, and exposes `openView` to the scanner.
 */
import { OdysseyProvider } from '@okta/odyssey-react-mui';
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import type { ViewTarget } from '../views/types';
import { OWN_ATTR } from './dom';
import { ViewDialog } from './ViewDialog';

// A tiny store holding the target whose dialog is open.
let current: ViewTarget | undefined;
const listeners = new Set<() => void>();
const setCurrent = (target: ViewTarget | undefined) => {
  current = target;
  listeners.forEach((l) => l());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const App = () => {
  const target = useSyncExternalStore(subscribe, () => current);
  return target ? (
    <ViewDialog key={target.key} target={target} onClose={() => setCurrent(undefined)} />
  ) : null;
};

export function mountViewHost(): { openView: (target: ViewTarget) => void } {
  const host = document.createElement('div');
  host.setAttribute(OWN_ATTR, 'host');
  document.body.append(host);

  // No `contain`/positioning on the host: the dialog is `position: fixed` and must
  // be laid out against the viewport.
  const shadowRoot = host.attachShadow({ mode: 'open' });
  const hostStyle = document.createElement('style');
  hostStyle.textContent = ':host { all: initial; }';
  const emotionRootElement = document.createElement('div');
  const appRootElement = document.createElement('div');
  shadowRoot.append(hostStyle, emotionRootElement, appRootElement);

  createRoot(appRootElement).render(
    <OdysseyProvider emotionRootElement={emotionRootElement} shadowRootElement={appRootElement}>
      <App />
    </OdysseyProvider>,
  );

  return { openView: setCurrent };
}
