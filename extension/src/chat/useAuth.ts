import { useCallback, useEffect, useState } from 'react';

import type { AuthStatus, WorkerRequest } from '../background/messages';

/** The worker's status, or `noWorker` when the service worker didn't answer (it failed to start). */
export type ChatStatus = AuthStatus | { state: 'noWorker'; error: string };

const ask = async (request: WorkerRequest): Promise<ChatStatus> => {
  try {
    const status = await chrome.runtime.sendMessage<WorkerRequest, AuthStatus | undefined>(request);
    return status ?? { state: 'noWorker', error: 'No answer from the service worker.' };
  } catch (error) {
    return { state: 'noWorker', error: String(error) };
  }
};

/**
 * Sign-in state, from the service worker, checked again when the chat server URL
 * changes. Signing in is silent when the Okta session is valid.
 */
export function useAuth(serverUrl: string | undefined) {
  const [status, setStatus] = useState<ChatStatus>();

  const refresh = useCallback(() => void ask({ type: 'oktamax:authStatus' }).then(setStatus), []);
  useEffect(() => {
    if (serverUrl !== undefined) refresh();
  }, [refresh, serverUrl]);

  const signIn = async () => setStatus(await ask({ type: 'oktamax:signIn' }));

  return { status, signIn, refresh };
}

/** acme-admin.okta.com is the admin console of the acme.okta.com org. */
export const isAdminConsoleOf = (orgUrl: string) =>
  location.hostname.replace(/-admin\./, '.') === new URL(orgUrl).hostname;
