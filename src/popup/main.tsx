import { Box, Heading6, OdysseyProvider, Paragraph, Switch } from '@okta/odyssey-react-mui';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { loadSettings, saveSettings, type Settings } from '../settings';

const Popup = () => {
  const [settings, setSettings] = useState<Settings>();

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const toggle = ({ checked }: { checked: boolean }) => {
    setSettings({ alwaysShowViewButton: checked });
    void saveSettings({ alwaysShowViewButton: checked });
  };

  return (
    <Box sx={{ padding: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <img src="/icons/icon-32.png" width={32} height={32} alt="" />
        <Heading6>Okta Max</Heading6>
      </Box>
      <Paragraph>
        Adds a view icon wherever the admin console hides an Edit button, opening the same form
        read-only.
      </Paragraph>
      {settings && (
        <Switch
          label="Show view icons next to Edit buttons too"
          hint="Useful for comparing against the real edit dialogs as a full admin."
          value="alwaysShowViewButton"
          isChecked={settings.alwaysShowViewButton}
          onChange={toggle}
        />
      )}
    </Box>
  );
};

createRoot(document.getElementById('root')!).render(
  <OdysseyProvider>
    <Popup />
  </OdysseyProvider>,
);
