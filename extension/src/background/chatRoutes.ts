/**
 * The chat server's routes (`server/src/chat/routes.ts`), served from the service
 * worker: by the on-device assistant, and by the mock in dev builds. Like the
 * server, replies keep generating across page loads, and a new page replays the
 * one in flight. History is kept in `chrome.storage.local`.
 */
import { UI_MESSAGE_STREAM_HEADERS, type UIMessage } from 'ai';

import type { ChatMessageMetadata, SendMessageBody } from '@oktamax/shared';
import type { StreamBuffer } from '@oktamax/shared/streamBuffer';

import type { BridgeRequest } from './messages';

export type Message = UIMessage<ChatMessageMetadata>;

/** Starts a reply to the last of `messages`; calls `save` with the final messages when it ends. */
export type StartReply = (
  messages: Message[],
  save: (messages: Message[]) => Promise<void>,
) => StreamBuffer;

const sse = (stream: ReadableStream<string>) =>
  new Response(stream.pipeThrough(new TextEncoderStream()), { headers: UI_MESSAGE_STREAM_HEADERS });

export function serveChats(storageKey: string, start: StartReply) {
  const running = new Map<string, StreamBuffer>();

  const loadChats = async () =>
    ((await chrome.storage.local.get(storageKey))[storageKey] ?? {}) as Record<string, Message[]>;

  const saveChat = async (id: string, messages: Message[]) =>
    chrome.storage.local.set({ [storageKey]: { ...(await loadChats()), [id]: messages } });

  return async (request: BridgeRequest): Promise<Response> => {
    const match = /^\/api\/chats\/([^/]+)(\/messages|\/stream|\/stop)?$/.exec(
      new URL(request.url).pathname,
    );
    if (!match) return Response.json({ error: 'not_found' }, { status: 404 });
    const chatId = decodeURIComponent(match[1]!);
    const route = `${request.method} ${match[2] ?? ''}`;

    if (route === 'GET ') {
      const messages = (await loadChats())[chatId];
      if (!messages) return Response.json({ error: 'not_found' }, { status: 404 });
      return Response.json({ messages, running: running.has(chatId) });
    }
    if (route === 'POST /messages') {
      if (running.has(chatId)) return Response.json({ error: 'busy' }, { status: 409 });
      const { message } = JSON.parse(request.body ?? '{}') as SendMessageBody<Message>;
      const messages = [...((await loadChats())[chatId] ?? []), message];
      await saveChat(chatId, messages);
      const buffer = start(messages, async (final) => {
        await saveChat(chatId, final);
        running.delete(chatId);
      });
      running.set(chatId, buffer);
      return sse(buffer.replay());
    }
    if (route === 'GET /stream') {
      const buffer = running.get(chatId);
      return buffer ? sse(buffer.replay()) : new Response(null, { status: 204 });
    }
    if (route === 'POST /stop') {
      running.get(chatId)?.abort.abort();
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  };
}
