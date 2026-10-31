import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Field, FormView } from '../../form/schema';
import type { Authenticator } from '../../okta/types';
import { authenticatorView, consoleName } from '../authenticators';

/** Answer Okta API GETs from a fixture map. */
function mockApi(responses: Record<string, unknown>) {
  vi.stubGlobal('location', new URL('https://acme-admin.okta.com/admin/dashboard'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, init: RequestInit) => {
      expect(init.method).toBe('GET');
      const body = responses[url.pathname];
      return body === undefined
        ? new Response('{"errorSummary":"Not found"}', { status: 404 })
        : Response.json(body);
    }),
  );
}

const field = (view: FormView, label: string): Field | undefined =>
  view.sections.flatMap((s) => s.fields).find((f) => f.label === label);

const titles = (view: FormView) => view.sections.map((s) => s.title);

afterEach(() => vi.unstubAllGlobals());

describe('authenticatorView', () => {
  it('mirrors the Email dialog', async () => {
    const email: Authenticator = {
      id: 'aut1',
      key: 'okta_email',
      name: 'Email',
      type: 'email',
      status: 'ACTIVE',
      settings: { allowedFor: 'recovery', tokenLifetimeInMinutes: 5 },
    };
    mockApi({ '/api/v1/authenticators/aut1/methods': [{ type: 'email', status: 'ACTIVE' }] });
    const view = await authenticatorView(email);

    expect(view.width).toBe(650);
    expect(view.description).toMatch(/^If email is selected, Okta will send/);
    expect(view.description).not.toMatch(/Learn more/);
    expect(titles(view)).toEqual(['Settings', 'Used for (legacy)']);
    expect(field(view, 'Email challenge lifetime (minutes)')).toMatchObject({
      type: 'select',
      value: '5',
      options: [{ value: '5', label: '5 (default)' }],
    });
    expect(field(view, 'This authenticator can be used for:')).toMatchObject({
      type: 'radio',
      value: 'recovery',
      options: [
        { value: 'any', label: 'Authentication and recovery' },
        { value: 'recovery', label: 'Recovery in password policy rules' },
      ],
    });
    expect(view.raw).toMatchObject({ authenticator: email });
  });

  it('mirrors the Okta Verify dialog', async () => {
    const ov: Authenticator = {
      id: 'aut2',
      key: 'okta_verify',
      name: 'Okta Verify',
      type: 'app',
      status: 'ACTIVE',
      settings: {
        channelBinding: { style: 'NUMBER_CHALLENGE', required: 'HIGH_RISK_ONLY' },
        userVerification: 'PREFERRED',
        userVerificationMethods: ['PIN', 'BIOMETRICS'],
      },
    };
    mockApi({
      '/api/v1/authenticators/aut2/methods': [
        { type: 'push', status: 'INACTIVE' },
        { type: 'totp', status: 'ACTIVE' },
        { type: 'signed_nonce', status: 'ACTIVE' },
      ],
    });
    const view = await authenticatorView(ov);

    expect(titles(view)).toEqual([
      'Used for (legacy)',
      'Verification options',
      'Okta FastPass',
      'Device passcode or biometric user verification',
      'Push notification: number challenge',
    ]);
    expect(field(view, 'User can verify with')).toMatchObject({
      type: 'checkboxGroup',
      checked: ['totp', 'signed_nonce'],
      options: [
        { value: 'totp', label: 'TOTP (on by default) (Android and iOS only)' },
        { value: 'push', label: 'Push notification (Android and iOS only)' },
        { value: 'signed_nonce', label: 'Okta FastPass (All platforms)' },
      ],
    });
    expect(field(view, 'Enrollment')).toMatchObject({ type: 'radio', value: 'PREFERRED' });
    expect(field(view, 'Number challenge for Okta Verify push')).toMatchObject({
      type: 'radio',
      value: 'HIGH_RISK_ONLY',
      options: [
        { value: 'NEVER', label: 'Never' },
        { value: 'HIGH_RISK_ONLY', label: 'Only for high risk sign-in attempts' },
        { value: 'ALWAYS', label: 'All push challenges' },
      ],
    });
  });

  it('maps biometrics-only user verification for Okta Verify', async () => {
    mockApi({ '/api/v1/authenticators/aut3/methods': [] });
    const view = await authenticatorView({
      id: 'aut3',
      key: 'okta_verify',
      name: 'Okta Verify',
      type: 'app',
      status: 'ACTIVE',
      settings: { userVerification: 'REQUIRED', userVerificationMethods: ['BIOMETRICS'] },
    });
    expect(field(view, 'Enrollment')).toMatchObject({ value: 'REQUIRED_BIOMETRICS' });
    expect(field(view, 'Number challenge for Okta Verify push')).toBeUndefined();
  });

  it('reads Passkey settings from the webauthn method', async () => {
    mockApi({
      '/api/v1/authenticators/aut4/methods': [
        {
          type: 'webauthn',
          status: 'ACTIVE',
          settings: {
            userVerification: 'REQUIRED',
            userVerificationForVerify: 'PREFERRED',
            residentKeyRequirement: 'REQUIRED',
          },
        },
      ],
    });
    const passkey = {
      id: 'aut4',
      key: 'webauthn',
      name: 'Passkeys',
      type: 'security_key',
      status: 'ACTIVE',
    };
    const view = await authenticatorView(passkey);
    expect(consoleName(passkey)).toBe('Passkey (FIDO2 WebAuthn)');
    expect(field(view, 'Create passkeys')).toMatchObject({ type: 'checkbox', checked: true });
    expect(field(view, 'Enrollment')).toMatchObject({ value: 'REQUIRED' });
    expect(field(view, 'Authentication')).toMatchObject({ value: 'PREFERRED' });
  });

  it('shows Phone methods and falls back to settings for unknown authenticators', async () => {
    mockApi({
      '/api/v1/authenticators/aut5/methods': [
        { type: 'sms', status: 'ACTIVE' },
        { type: 'voice', status: 'INACTIVE' },
      ],
    });
    const phone = await authenticatorView({
      id: 'aut5',
      key: 'phone_number',
      name: 'Phone',
      type: 'phone',
      status: 'ACTIVE',
      settings: { allowedFor: 'any' },
    });
    expect(field(phone, 'User can verify with')).toMatchObject({ checked: ['sms'] });
    expect(field(phone, 'This authenticator can be used for:')).toMatchObject({ value: 'any' });

    const password = await authenticatorView({
      id: 'aut6',
      key: 'okta_password',
      name: 'Password',
      type: 'password',
      status: 'ACTIVE',
    });
    expect(field(password, 'Name')).toMatchObject({ value: 'Password' });
  });
});
