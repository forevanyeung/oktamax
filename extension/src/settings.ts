export type Theme = 'light' | 'dark' | 'system';

/**
 * Where the assistant runs: nowhere (off), the chat server, or in Chrome (Gemini Nano and
 * Okta's MCP server on WebAssembly). Can be enforced by policy (see `loadManagedSettings`).
 */
export type AssistantMode = 'off' | 'server' | 'onDevice';

export interface Settings {
  /** Show view buttons even where Okta shows an Edit button (handy for testing as a super admin). */
  alwaysShowViewButton: boolean;
  /** Admin console theme; `system` follows the OS appearance. */
  theme: Theme;
  /** Show the API console drawer at the bottom of the admin console. */
  showApiConsole: boolean;
  /**
   * Base URL of the chat server, e.g. https://oktamax.example.com. Empty, the default until the
   * admin sets one, disables the chat.
   * Can be enforced by policy (see `loadManagedSettings`).
   */
  chatServerUrl: string;
  assistant: AssistantMode;
}

const defaults: Settings = {
  alwaysShowViewButton: false,
  theme: 'system',
  showApiConsole: true,
  // Dev builds go to the local server (`npm run dev:server`), or the mock when it isn't running.
  chatServerUrl: import.meta.env.DEV ? 'http://localhost:8787' : '',
  assistant: 'off',
};

/**
 * Stands in for the chat server's URL when the assistant runs on-device: the chat
 * sends its requests here as usual, and the service worker answers them itself.
 */
export const ON_DEVICE_CHAT_URL = 'https://on-device.oktamax.invalid';

/** The URL the chat sends its requests to; empty when the assistant is off. */
export const chatUrl = (settings: Settings) =>
  settings.assistant === 'off'
    ? ''
    : settings.assistant === 'onDevice'
      ? ON_DEVICE_CHAT_URL
      : settings.chatServerUrl;

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
