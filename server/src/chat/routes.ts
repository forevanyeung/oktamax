/**
 * Chat API used by the extension:
 *
 *   GET  /api/chats/:id            history (404 if new)
 *   POST /api/chats/:id/messages   send one message, stream the reply
 *   GET  /api/chats/:id/stream     resume the in-flight reply (204 if none)
 *   POST /api/chats/:id/stop       stop the in-flight reply
 *
 * Replies keep generating if the admin navigates away mid-answer; the next page
 * load resumes the stream, or loads the finished message from history.
 */
import { createMCPClient } from '@ai-sdk/mcp';
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  UI_MESSAGE_STREAM_HEADERS,
  validateUIMessages,
  type LanguageModel,
} from 'ai';
import { Hono } from 'hono';
import * as z from 'zod';

import { StreamBuffer } from '@oktamax/shared/streamBuffer';

import { requireAuth } from '../auth';
import { pageTools } from './pageTools';
import { instructions, withPageContext } from './prompt';
import type { Chat, ChatMessage, ChatStore } from './store';

export interface ChatDeps {
  model: LanguageModel;
  store: ChatStore;
  /** URL of the Okta MCP server the model's tools come from. */
  mcpUrl: string;
}

const pageContextSchema = z.object({
  url: z.string(),
  title: z.string(),
  headings: z.array(z.string()),
  objectIds: z.array(z.string()),
  selection: z.string().optional(),
  text: z.string().max(20_000),
});
const metadataSchema = z.object({ page: pageContextSchema.optional() }).optional();

export function createChatRoutes({ model, store, mcpUrl }: ChatDeps) {
  const chatRoutes = new Hono().use(requireAuth);

  /** The admin's own chat, or a 404/403 response. New IDs create an empty chat when `create`. */
  function loadChat(id: string, userId: string, create = false): Chat | Response {
    const chat = store.get(id);
    if (!chat) {
      if (!create) return Response.json({ error: 'not_found' }, { status: 404 });
      return { id, ownerId: userId, messages: [], updatedAt: Date.now() };
    }
    if (chat.ownerId !== userId) return Response.json({ error: 'forbidden' }, { status: 403 });
    return chat;
  }

  chatRoutes.get('/:id', (c) => {
    const chat = loadChat(c.req.param('id'), c.var.principal.userId);
    if (chat instanceof Response) return chat;
    return c.json({ messages: chat.messages, running: Boolean(chat.active) });
  });

  chatRoutes.post('/:id/messages', async (c) => {
    const principal = c.var.principal;
    const chat = loadChat(c.req.param('id'), principal.userId, true);
    if (chat instanceof Response) return chat;
    if (chat.active) return c.json({ error: 'busy' }, 409);

    const { message } = await c.req.json<{ message: unknown }>();
    chat.messages = await validateUIMessages<ChatMessage>({
      messages: [...chat.messages, message],
      metadataSchema,
    });
    store.save(chat);

    // The MCP server gets the admin's own token, so every Okta call is made as them.
    const mcp = await createMCPClient({
      transport: {
        type: 'http',
        url: mcpUrl,
        headers: { Authorization: `Bearer ${principal.token}` },
      },
    });
    const abort = new AbortController();

    const result = streamText({
      model,
      instructions: instructions(principal.username),
      messages: await convertToModelMessages(withPageContext(chat.messages), {
        ignoreIncompleteToolCalls: true,
      }),
      tools: { ...(await mcp.tools()), ...pageTools },
      stopWhen: isStepCount(20),
      abortSignal: abort.signal,
    });

    const stream = toUIMessageStream({
      stream: result.stream,
      originalMessages: chat.messages,
      generateMessageId: () => crypto.randomUUID(),
      sendReasoning: false,
      onEnd: async ({ messages }) => {
        chat.messages = messages;
        chat.active = undefined;
        store.save(chat);
        await mcp.close();
      },
      onError: (error) => {
        console.error('[chat]', error);
        return 'Something went wrong generating a response.';
      },
    });

    return createUIMessageStreamResponse({
      stream,
      // A copy of the stream that keeps running even if this client disconnects.
      consumeSseStream: ({ stream: copy }) => {
        chat.active = new StreamBuffer(copy, abort);
        store.save(chat);
      },
    });
  });

  chatRoutes.get('/:id/stream', (c) => {
    const chat = loadChat(c.req.param('id'), c.var.principal.userId);
    if (chat instanceof Response || !chat.active) return c.body(null, 204);

    const body = chat.active.replay().pipeThrough(new TextEncoderStream());
    return new Response(body, { headers: UI_MESSAGE_STREAM_HEADERS });
  });

  chatRoutes.post('/:id/stop', (c) => {
    const chat = loadChat(c.req.param('id'), c.var.principal.userId);
    if (chat instanceof Response) return chat;
    chat.active?.abort.abort();
    return c.body(null, 204);
  });

  return chatRoutes;
}
