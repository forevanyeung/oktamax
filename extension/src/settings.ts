export type Theme = 'light' | 'dark' | 'system';

/** Where the assistant runs: the chat server, or in Chrome (Gemini Nano and Okta's MCP server on WebAssembly). */
export type AssistantMode = 'server' | 'onDevice';

export interface Settings {
  /** Show view buttons even where Okta shows an Edit button (handy for testing as a super admin). */
  alwaysShowViewButton: boolean;
  /** Admin console theme; `system` follows the OS appearance. */
  theme: Theme;
  /** Show the API console drawer at the bottom of the admin console. */
  showApiConsole: boolean;
  /** Base URL of the chat server, e.g. https://oktamax.example.com. Empty disables the chat. */
  chatServerUrl: string;
  assistant: AssistantMode;
  /** On-device only (the chat server provides these otherwise): the org, and the OIDC app to sign in with. */
  oktaOrgUrl: string;
  oktaClientId: string;
}

const defaults: Settings = {
  alwaysShowViewButton: false,
  theme: 'system',
  showApiConsole: true,
  chatServerUrl: 'http://localhost:8787',
  assistant: 'server',
  oktaOrgUrl: '',
  oktaClientId: '',
};

/**
 * Stands in for the chat server's URL when the assistant runs on-device: the chat
 * sends its requests here as usual, and the service worker answers them itself.
 */
export const ON_DEVICE_CHAT_URL = 'https://on-device.oktamax.invalid';

/** The URL the chat sends its requests to; empty when the assistant is off. */
export const chatUrl = (settings: Settings) =>
  settings.assistant === 'onDevice' ? ON_DEVICE_CHAT_URL : settings.chatServerUrl;

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
