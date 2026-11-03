import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { openModelPage, useModelAvailability } from '../model/availability';
import {
  loadSettings,
  saveSettings,
  watchDarkMode,
  type AssistantMode,
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

const ASSISTANTS: Array<[AssistantMode, string]> = [
  ['server', 'Chat server'],
  ['onDevice', 'On-device'],
];

/**
 * Chrome's built-in model: whether it's ready, kept up to date while the popup is
 * open. Downloading happens in a tab (`src/model/`), which outlives the popup.
 */
const ModelStatus = () => {
  const [availability] = useModelAvailability();

  if (!availability) return null;
  return (
    <div className="model">
      {availability === 'available' ? (
        <small>Chrome’s built-in model is ready.</small>
      ) : availability.startsWith('unavailable') ? (
        <small className="error">
          Chrome’s built-in model can’t run on this device ({availability}).
        </small>
      ) : (
        <>
          <small>
            {availability === 'downloading'
              ? 'Chrome is downloading its built-in model (Gemini Nano)…'
              : 'Chrome’s built-in model (Gemini Nano) needs to be downloaded once.'}
          </small>
          <button type="button" onClick={() => void openModelPage()}>
            {availability === 'downloading' ? 'Show progress' : 'Download'}
          </button>
        </>
      )}
    </div>
  );
};

void watchDarkMode((dark) => (document.documentElement.dataset.theme = dark ? 'dark' : 'light'));

const Popup = () => {
  const [settings, setSettings] = useState<Settings>();
  const [serverUrl, setServerUrl] = useState('');
  const [serverError, setServerError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setServerUrl(s.chatServerUrl);
    });
  }, []);

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
        <fieldset className="theme">
          <legend>Assistant</legend>
          {ASSISTANTS.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="assistant"
                value={value}
                checked={settings.assistant === value}
                onChange={() => update({ assistant: value })}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      {settings?.assistant === 'onDevice' && (
        <div className="server">
          <small>
            Runs in Chrome, with Client-side AI.
          </small>
          <ModelStatus />
        </div>
      )}
      {settings?.assistant === 'server' && (
        <form
          className="server"
          onSubmit={(e) => {
            e.preventDefault();
            void saveServer();
          }}
        >
          <label htmlFor="server-url">Chat server URL</label>
          <small>Leave empty to turn the assistant off.</small>
          <div>
            <input
              id="server-url"
              type="url"
              value={serverUrl}
              placeholder="https://oktamax.example.com"
              aria-invalid={!!serverError}
              onChange={(e) => {
                setServerUrl(e.target.value);
                setSaved(false);
              }}
            />
            <button type="submit">{saved ? 'Saved' : 'Save'}</button>
          </div>
          {serverError && <small className="error">{serverError}</small>}
        </form>
      )}
    </main>
  );
};

createRoot(document.getElementById('root')!).render(<Popup />);
