import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { loadSettings, saveSettings, watchDarkMode, type Settings, type Theme } from '../settings';

const THEMES: Array<[Theme, string]> = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System'],
];

void watchDarkMode((dark) => (document.documentElement.dataset.theme = dark ? 'dark' : 'light'));

const Popup = () => {
  const [settings, setSettings] = useState<Settings>();

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const update = (change: Partial<Settings>) => {
    setSettings((current) => current && { ...current, ...change });
    void saveSettings(change);
  };

  return (
    <main>
      <header>
        <img src="/icons/icon-32.png" width={32} height={32} alt="" />
        <h1>Okta Max</h1>
      </header>
      <p>
        Adds a view icon wherever the admin console hides an Edit button, opening the same form
        read-only.
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
    </main>
  );
};

createRoot(document.getElementById('root')!).render(<Popup />);
