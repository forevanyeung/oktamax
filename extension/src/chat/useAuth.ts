import { useCallback, useEffect, useState } from 'react';

import type { AuthStatus, WorkerRequest } from '../background/messages';

const ask = (request: WorkerRequest) =>
  chrome.runtime.sendMessage<WorkerRequest, AuthStatus>(request);

/** Sign-in state, from the service worker. Signing in is silent when the Okta session is valid. */
export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>();

  const refresh = useCallback(() => void ask({ type: 'oktamax:authStatus' }).then(setStatus), []);
  useEffect(refresh, [refresh]);

  const signIn = async () => setStatus(await ask({ type: 'oktamax:signIn' }));

  return { status, signIn, refresh };
}

/** acme-admin.okta.com is the admin console of the acme.okta.com org. */
export const isAdminConsoleOf = (orgUrl: string) =>
  location.hostname.replace(/-admin\./, '.') === new URL(orgUrl).hostname;
