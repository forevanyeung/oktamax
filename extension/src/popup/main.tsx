import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  loadManagedSettings,
  loadSettings,
  saveSettings,
  watchDarkMode,
  type Settings,
  type Theme,
} from '../settings';

/** The service worker needs host permission to reach the chat server. */
const requestServerAccess = (url: string) =>
  chrome.permissions.request({ origins: [`${new URL(url).origin}/*`] });

const THEMES: Array<[Theme, string]> = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System'],
];

void watchDarkMode((dark) => (document.documentElement.dataset.theme = dark ? 'dark' : 'light'));

const Popup = () => {
  const [settings, setSettings] = useState<Settings>();
  const [serverUrl, setServerUrl] = useState('');
  const [serverError, setServerError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [managed, setManaged] = useState<Partial<Settings>>({});

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setServerUrl(s.chatServerUrl);
    });
    void loadManagedSettings().then(setManaged);
  }, []);
  const serverManaged = managed.chatServerUrl !== undefined;

  const update = (change: Partial<Settings>) => {
    setSettings((current) => current && { ...current, ...change });
    void saveSettings(change);
  };

  const saveServer = async () => {
    setServerError(undefined);
    setSaved(false);
    if (serverUrl) {
      try {
        if (!(await requestServerAccess(serverUrl))) {
          setServerError('Permission to reach the chat server was not granted.');
          return;
        }
      } catch {
        setServerError('Enter a full URL, e.g. https://oktamax.example.com');
        return;
      }
    }
    update({ chatServerUrl: serverUrl.replace(/\/+$/, '') });
    setSaved(true);
  };

  return (
    <main>
      <header>
        <img src="/icons/icon-32.png" width={32} height={32} alt="" />
        <h1>Okta Max</h1>
      </header>
      <p>
        Adds a view icon wherever the admin console hides an Edit button, opening the same form
        read-only, and an assistant you can ask about the org.
      </p>
      {settings && (
        <fieldset className="theme">
          <legend>Admin console theme</legend>
          {THEMES.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="theme"
                value={value}
                checked={settings.theme === value}
                onChange={() => update({ theme: value })}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      {settings && (
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.alwaysShowViewButton}
            onChange={(e) => update({ alwaysShowViewButton: e.target.checked })}
          />
          <span>
            Show view icons next to Edit buttons too
            <small>Useful for comparing against the real edit dialogs as a full admin.</small>
          </span>
        </label>
      )}
      {settings && (
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.showApiConsole}
            onChange={(e) => update({ showApiConsole: e.target.checked })}
          />
          <span>
            Show the API console
            <small>
              A drawer at the bottom of the console for sending API requests (Ctrl + `).
            </small>
          </span>
        </label>
      )}
      {settings && (
        <form
          className="server"
          onSubmit={(e) => {
            e.preventDefault();
            void saveServer();
          }}
        >
          <label htmlFor="server-url">Chat server URL</label>
          <small>
            {serverManaged ? 'Set by your organization.' : 'Leave empty to turn the assistant off.'}
          </small>
          <div>
            <input
              id="server-url"
              type="url"
              value={serverUrl}
              placeholder="https://oktamax.example.com"
              disabled={serverManaged}
              aria-invalid={!!serverError}
              onChange={(e) => {
                setServerUrl(e.target.value);
                setSaved(false);
              }}
            />
            <button type="submit" hidden={serverManaged}>
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
          {serverError && <small className="error">{serverError}</small>}
        </form>
      )}
    </main>
  );
};

createRoot(document.getElementById('root')!).render(<Popup />);
