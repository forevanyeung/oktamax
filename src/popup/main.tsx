import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { loadSettings, saveSettings, type Settings } from '../settings';

const Popup = () => {
  const [settings, setSettings] = useState<Settings>();

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const toggle = (checked: boolean) => {
    setSettings({ alwaysShowViewButton: checked });
    void saveSettings({ alwaysShowViewButton: checked });
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
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.alwaysShowViewButton}
            onChange={(e) => toggle(e.target.checked)}
          />
          <span>
            Show view icons next to Edit buttons too
            <small>Useful for comparing against the real edit dialogs as a full admin.</small>
          </span>
        </label>
      )}
    </main>
  );
};

createRoot(document.getElementById('root')!).render(<Popup />);
