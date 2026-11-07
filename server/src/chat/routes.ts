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

import { orgFromHeader, principalKey, requireAuth } from '../auth';
import type { OktaMcpProcessPool } from '../mcp/processPool';
import { pageTools } from './pageTools';
import { instructions, withPageContext } from './prompt';
import type { Chat, ChatMessage, ChatStore } from './store';

export interface ChatDeps {
  model: LanguageModel;
  store: ChatStore;
  /** Base URL of the Okta MCP servers the model's tools come from (`<mcpUrl>/<org host>`). */
  mcpUrl: string;
  /** The admins' Okta MCP processes behind `mcpUrl`, started early when a chat opens. */
  oktaMcp: Pick<OktaMcpProcessPool, 'prepare'>;
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

export function createChatRoutes({ model, store, mcpUrl, oktaMcp }: ChatDeps) {
  // The extension says which org's admin console the chat is on (X-Okta-Org).
  const chatRoutes = new Hono().use(requireAuth(orgFromHeader));

  /** The admin's own chat, or a 404/403 response. New IDs create an empty chat when `create`. */
  function loadChat(id: string, ownerId: string, create = false): Chat | Response {
    const chat = store.get(id);
    if (!chat) {
      if (!create) return Response.json({ error: 'not_found' }, { status: 404 });
      return { id, ownerId, messages: [], updatedAt: Date.now() };
    }
    if (chat.ownerId !== ownerId) return Response.json({ error: 'forbidden' }, { status: 403 });
    return chat;
  }

  chatRoutes.get('/:id', (c) => {
    // The extension loads the history when the chat opens: start the admin's Okta MCP
    // process now, so it's running by the time they ask something.
    oktaMcp
      .prepare(c.var.principal)
      .catch((error) => console.error(`Okta MCP for ${principalKey(c.var.principal)}: ${error}`));
    const chat = loadChat(c.req.param('id'), principalKey(c.var.principal));
    if (chat instanceof Response) return chat;
    return c.json({ messages: chat.messages, running: Boolean(chat.active) });
  });

  chatRoutes.post('/:id/messages', async (c) => {
    const principal = c.var.principal;
    const chat = loadChat(c.req.param('id'), principalKey(principal), true);
    if (chat instanceof Response) return chat;
    if (chat.active) return c.json({ error: 'busy' }, 409);

    const { message } = await c.req.json<{ message: unknown }>();
    const messages = await validateUIMessages<ChatMessage>({
      messages: [...chat.messages, message],
      metadataSchema,
    });
    // Text only: the AI SDK downloads the URLs of file parts from this server (SSRF).
    if (!messages.at(-1)!.parts.every((part) => part.type === 'text')) {
      return c.json({ error: 'unsupported_part' }, 400);
    }
    chat.messages = messages;
    store.save(chat);

    // The MCP server gets the admin's own token, so every Okta call is made as them.
    const mcp = await createMCPClient({
      transport: {
        type: 'http',
        url: `${mcpUrl}/${principal.org.host}`,
        headers: { Authorization: `Bearer ${principal.token}` },
      },
    });
    const abort = new AbortController();

    const result = streamText({
      model,
      instructions: instructions(principal.username, mcp.instructions),
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
    const chat = loadChat(c.req.param('id'), principalKey(c.var.principal));
    if (chat instanceof Response || !chat.active) return c.body(null, 204);

    const body = chat.active.replay().pipeThrough(new TextEncoderStream());
    return new Response(body, { headers: UI_MESSAGE_STREAM_HEADERS });
  });

  chatRoutes.post('/:id/stop', (c) => {
    const chat = loadChat(c.req.param('id'), principalKey(c.var.principal));
    if (chat instanceof Response) return chat;
    chat.active?.abort.abort();
    return c.body(null, 204);
  });

  return chatRoutes;
}
