/**
 * Mounts a React root inside a shadow DOM, so Okta's page CSS and ours can't
 * affect each other. Hosts the read-only view dialogs (exposing `openView` to the
 * scanner), the API console and the chat.
 */
import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import { ApiConsole } from '../console/ApiConsole';
import { consoleStyles } from '../console/styles';
import { dialogStyles } from '../form/styles';
import { watchDarkMode } from '../settings';
import { ChatLauncher } from '../chat/ChatPanel';
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
  return (
    <>
      <ApiConsole />
      {target && (
        <ViewDialog key={target.key} target={target} onClose={() => setCurrent(undefined)} />
      )}
      <ChatLauncher />
    </>
  );
};

export function mountViewHost(): { openView: (target: ViewTarget) => void } {
  const host = document.createElement('div');
  host.setAttribute(OWN_ATTR, 'host');
  document.body.append(host);

  // No `contain`/positioning on the host: the dialog is `position: fixed` and must
  // be laid out against the viewport.
  void watchDarkMode((dark) => host.setAttribute('data-theme', dark ? 'dark' : 'light'));

  const shadowRoot = host.attachShadow({ mode: 'open' });
  const hostStyle = document.createElement('style');
  hostStyle.textContent = `:host { all: initial; }\n${dialogStyles}\n${consoleStyles}`;
  const appRootElement = document.createElement('div');
  shadowRoot.append(hostStyle, appRootElement);

  createRoot(appRootElement).render(<App />);

  return { openView: setCurrent };
}
