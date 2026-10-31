export type Theme = 'light' | 'dark' | 'system';

export interface Settings {
  /** Show view buttons even where Okta shows an Edit button (handy for testing as a super admin). */
  alwaysShowViewButton: boolean;
  /** Admin console theme; `system` follows the OS appearance. */
  theme: Theme;
}

const defaults: Settings = { alwaysShowViewButton: false, theme: 'system' };

export const loadSettings = async (): Promise<Settings> =>
  ({ ...defaults, ...(await chrome.storage.sync.get(defaults)) }) as Settings;

export const saveSettings = (settings: Partial<Settings>) => chrome.storage.sync.set(settings);

export const onSettingsChanged = (callback: (settings: Settings) => void) =>
  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area === 'sync') callback(await loadSettings());
  });

const systemDark = () => matchMedia('(prefers-color-scheme: dark)');

/** Calls `callback` with whether the theme is dark now, and whenever that changes. */
export async function watchDarkMode(callback: (dark: boolean) => void) {
  let theme = (await loadSettings()).theme;
  const emit = () => callback(theme === 'dark' || (theme === 'system' && systemDark().matches));
  emit();
  systemDark().addEventListener('change', emit);
  onSettingsChanged((next) => {
    theme = next.theme;
    emit();
  });
}
