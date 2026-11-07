import { useEffect, useState } from 'react';

import { openModelPage, useModelAvailability } from '../model/availability';
import { renderRoot } from '../renderRoot';
import {
  loadManagedSettings,
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
  ['off', 'Off'],
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

/**
 * Whether the active tab is the admin console, matching the manifest's content
 * scripts. Without the `tabs` permission Chrome only reveals the URL of tabs on
 * our host permissions, so other pages come back without one.
 */
const onAdminConsole = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return false;
  const { protocol, hostname } = new URL(tab.url);
  return (
    protocol === 'https:' &&
    /^[^.]+-admin\.(okta|oktapreview|okta-emea|okta-gov)\.com$/.test(hostname)
  );
};

void watchDarkMode((dark) => (document.documentElement.dataset.theme = dark ? 'dark' : 'light'));

const Popup = () => {
  const [onOkta, setOnOkta] = useState<boolean>();
  const [settings, setSettings] = useState<Settings>();
  const [serverUrl, setServerUrl] = useState('');
  const [serverError, setServerError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [managed, setManaged] = useState<Partial<Settings>>({});

  useEffect(() => {
    void onAdminConsole().then(setOnOkta);
    void loadSettings().then((s) => {
      setSettings(s);
      setServerUrl(s.chatServerUrl);
    });
    void loadManagedSettings().then(setManaged);
  }, []);
  const serverManaged = managed.chatServerUrl !== undefined;
  const assistantManaged = managed.assistant !== undefined;

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

  const header = (
    <header>
      <img src="/icons/icon-32.png" width={32} height={32} alt="" />
      <h1>Okta Max</h1>
    </header>
  );

  if (onOkta === undefined) return null;
  if (!onOkta) {
    return (
      <main>
        {header}
        <p>Switch to the Okta admin console to open Okta Max.</p>
      </main>
    );
  }

  return (
    <main>
      {header}
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
                disabled={assistantManaged}
                onChange={() => update({ assistant: value })}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      {assistantManaged && <small>Set by your organization.</small>}
      {settings?.assistant === 'onDevice' && (
        <div className="server">
          <small>Runs in Chrome, with Client-side AI.</small>
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
          {serverManaged && <small>Set by your organization.</small>}
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

renderRoot(<Popup />);
