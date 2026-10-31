/**
 * Connects the AI SDK chat to the chat server, with history loaded from the
 * server and resume enabled – so a page navigation mid-answer just reconnects
 * to the same, still-running reply.
 */
import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useMemo, useState } from 'react';

import type { ChatMessageMetadata, SendMessageBody } from '@oktamax/shared';

import { bridgeFetch } from './bridgeFetch';
import { capturePageContext } from './pageContext';

export type OktaChatMessage = UIMessage<ChatMessageMetadata>;

const chatUrl = (serverUrl: string, chatId: string, path = '') =>
  new URL(`/api/chats/${encodeURIComponent(chatId)}${path}`, serverUrl).href;

/** Load the chat's history; `undefined` while loading. */
export function useChatHistory(serverUrl: string, chatId: string) {
  const [history, setHistory] = useState<{ chatId: string; messages: OktaChatMessage[] }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    void bridgeFetch(chatUrl(serverUrl, chatId))
      .then(async (res) => {
        if (res.status === 404) return [];
        if (!res.ok) throw new Error(`Couldn't load the chat (${res.status})`);
        return ((await res.json()) as { messages: OktaChatMessage[] }).messages;
      })
      .then((messages) => !cancelled && setHistory({ chatId, messages }))
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [serverUrl, chatId]);

  return { messages: history?.chatId === chatId ? history.messages : undefined, error };
}

export function useOktaChat(serverUrl: string, chatId: string, initialMessages: OktaChatMessage[]) {
  const chat = useMemo(
    () =>
      new Chat<OktaChatMessage>({
        id: chatId,
        messages: initialMessages,
        transport: new DefaultChatTransport<OktaChatMessage>({
          api: chatUrl(serverUrl, ''),
          fetch: bridgeFetch,
          // The server keeps the history: send only the new message, stamped with
          // the page it was asked from.
          prepareSendMessagesRequest: ({ id, messages }) => {
            const message = messages.at(-1)!;
            const body: SendMessageBody<OktaChatMessage> = {
              message: {
                ...message,
                metadata: { ...message.metadata, page: capturePageContext() },
              },
            };
            return { api: chatUrl(serverUrl, id, '/messages'), body };
          },
          // Default resume URL is `${api}/${id}/stream`; spell it out for clarity.
          prepareReconnectToStreamRequest: ({ id }) => ({ api: chatUrl(serverUrl, id, '/stream') }),
        }),
      }),
    // A new Chat only when switching chats; history is just the starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverUrl, chatId],
  );

  const helpers = useChat({ chat, resume: true });

  /** With resumable streams, aborting the request is just a disconnect – tell the server to stop. */
  const stop = async () => {
    await bridgeFetch(chatUrl(serverUrl, chatId, '/stop'), { method: 'POST' });
    await helpers.stop();
  };

  return { ...helpers, stop };
}
