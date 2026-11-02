export type Theme = 'light' | 'dark' | 'system';

export interface Settings {
  /** Show view buttons even where Okta shows an Edit button (handy for testing as a super admin). */
  alwaysShowViewButton: boolean;
  /** Admin console theme; `system` follows the OS appearance. */
  theme: Theme;
  /** Show the API console drawer at the bottom of the admin console. */
  showApiConsole: boolean;
  /**
   * Base URL of the chat server, e.g. https://oktamax.example.com. Empty disables the chat.
   * Can be enforced by policy (see `loadManagedSettings`).
   */
  chatServerUrl: string;
}

const defaults: Settings = {
  alwaysShowViewButton: false,
  theme: 'system',
  showApiConsole: true,
  chatServerUrl: 'http://localhost:8787',
};

/**
 * Settings enforced by the organization's policy (e.g. Google Workspace admin's "Policy for
 * extensions"), per `public/managed_schema.json`. They override what the admin picked.
 */
export const loadManagedSettings = async (): Promise<Partial<Settings>> => {
  try {
    return (await chrome.storage.managed.get()) as Partial<Settings>;
  } catch {
    return {}; // no policy store (e.g. some unmanaged or non-Chrome browsers)
  }
};

export const loadSettings = async (): Promise<Settings> =>
  ({
    ...defaults,
    ...(await chrome.storage.sync.get(defaults)),
    ...(await loadManagedSettings()),
  }) as Settings;

export const saveSettings = (settings: Partial<Settings>) => chrome.storage.sync.set(settings);

export const onSettingsChanged = (callback: (settings: Settings) => void) =>
  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area === 'sync' || area === 'managed') callback(await loadSettings());
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
