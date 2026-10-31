export interface Settings {
  /** Show view buttons even where Okta shows an Edit button (handy for testing as a super admin). */
  alwaysShowViewButton: boolean;
}

const defaults: Settings = { alwaysShowViewButton: false };

export const loadSettings = async (): Promise<Settings> =>
  ({ ...defaults, ...(await chrome.storage.sync.get(defaults)) }) as Settings;

export const saveSettings = (settings: Partial<Settings>) => chrome.storage.sync.set(settings);

export const onSettingsChanged = (callback: (settings: Settings) => void) =>
  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area === 'sync') callback(await loadSettings());
  });
