import { findItems } from '../content/dom';
import { section, select, text, type FormView } from '../form/schema';
import { get, getAll } from '../okta/api';
import type { Authenticator } from '../okta/types';
import { STATUS } from './format';
import { objectSections } from './generic';
import type { ViewProvider } from './types';

interface AuthenticatorMethod {
  type: string;
  status: string;
  settings?: Record<string, unknown>;
}

/**
 * Security › Authenticators › "Edit". Each authenticator has its own settings
 * shape, so the settings themselves are rendered generically.
 */
export async function authenticatorView(authenticator: Authenticator): Promise<FormView> {
  const methods = await get<AuthenticatorMethod[]>(
    `/api/v1/authenticators/${authenticator.id}/methods`,
  ).catch(() => []);

  return {
    sections: [
      section(undefined, [
        text('Name', authenticator.name),
        select('Status', authenticator.status, STATUS),
      ]),
      ...objectSections('Settings', authenticator.settings),
      ...objectSections('Provider', authenticator.provider?.configuration),
      ...methods.flatMap((m) => [
        section(`Method: ${m.type}`, [select('Status', m.status, STATUS)]),
        ...objectSections(`Method: ${m.type}`, m.settings),
      ]),
    ],
    raw: { authenticator, methods },
  };
}

/** The console's labels where they differ from the API's `name`, by authenticator key. */
const CONSOLE_NAMES: Record<string, string[]> = {
  webauthn: ['Passkey (FIDO2 WebAuthn)', 'FIDO2 (WebAuthn)'],
};

export const authenticatorsProvider: ViewProvider = {
  name: 'Authenticators',
  matches: (url) => /^\/admin\/access\/(multifactor|authenticators)/.test(url.pathname),
  async findTargets() {
    const authenticators = await getAll<Authenticator>('/api/v1/authenticators');
    return findItems(authenticators, (a) => [a.name, ...(CONSOLE_NAMES[a.key] ?? [])]).map(
      ({ item, anchor, scope }) => ({
        key: `authenticator:${item.id}`,
        title: `View ${item.name}`,
        anchor,
        scope,
        load: () => authenticatorView(item),
      }),
    );
  },
};
