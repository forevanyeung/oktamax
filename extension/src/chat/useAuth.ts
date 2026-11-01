import { useCallback, useEffect, useState } from 'react';

import type { AuthStatus, WorkerRequest } from '../background/messages';

/** The worker's status, or `noWorker` when the service worker didn't answer (it failed to start). */
export type ChatStatus = AuthStatus | { state: 'noWorker'; error: string };

/** A worker that failed to load leaves messages unanswered rather than failing them. */
const STATUS_TIMEOUT_MS = 5_000;

const ask = async (request: WorkerRequest, timeoutMs?: number): Promise<ChatStatus> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = chrome.runtime.sendMessage<WorkerRequest, AuthStatus | undefined>(request);
    const timeout = new Promise<undefined>((resolve) => {
      if (timeoutMs) timer = setTimeout(resolve, timeoutMs);
    });
    const status = await Promise.race([answer, timeout]);
    return status ?? { state: 'noWorker', error: 'No answer from the service worker.' };
  } catch (error) {
    return { state: 'noWorker', error: String(error) };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Sign-in state, from the service worker, checked again when the chat server URL
 * changes. Signing in is silent when the Okta session is valid.
 */
export function useAuth(serverUrl: string | undefined) {
  const [status, setStatus] = useState<ChatStatus>();

  const refresh = useCallback(
    () => void ask({ type: 'oktamax:authStatus' }, STATUS_TIMEOUT_MS).then(setStatus),
    [],
  );
  useEffect(() => {
    if (serverUrl !== undefined) refresh();
  }, [refresh, serverUrl]);

  const signIn = async () => setStatus(await ask({ type: 'oktamax:signIn' }));

  return { status, signIn, refresh };
}

/** acme-admin.okta.com is the admin console of the acme.okta.com org. */
export const isAdminConsoleOf = (orgUrl: string) =>
  location.hostname.replace(/-admin\./, '.') === new URL(orgUrl).hostname;
