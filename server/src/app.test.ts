/**
 * End-to-end through the real HTTP stack: Hono app + MCP server + AI SDK, with
 * Okta mocked at the fetch layer and a scripted model in place of Bedrock.
 */
import type { AddressInfo } from 'node:net';

import { createMCPClient } from '@ai-sdk/mcp';
import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { createApp } from './app';
import { MemoryChatStore } from './chat/store';
import { fakeOktaMcpPool, mockOkta, scriptedModel } from './testing';

mockOkta();
const model = scriptedModel();
const oktaMcp = fakeOktaMcpPool();

let server: ServerType;
let base: string;

beforeAll(async () => {
  // The chat route calls the MCP server over HTTP, so the app needs its own URL.
  let app: ReturnType<typeof createApp> | undefined;
  server = serve({ fetch: (request) => app!.fetch(request), port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  app = createApp({ model, store: new MemoryChatStore(), mcpUrl: `${base}/mcp`, oktaMcp });
});

afterAll(async () => {
  server.close();
  await oktaMcp.closeAll();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const page = {
  url: 'https://acme-admin.okta.com/admin/users',
  title: 'People',
  headings: ['People'],
  objectIds: [],
  text: 'People list',
};

const mcpClient = (token: string) =>
  createMCPClient({ transport: { type: 'http', url: `${base}/mcp`, headers: auth(token) } });

/** Call list_users and return what the fake Okta MCP server reports about itself. */
async function listUsersAs(token: string) {
  const client = await mcpClient(token);
  const result = await client.callTool({ name: 'list_users', arguments: {} });
  await client.close();
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  return (JSON.parse(text) as { servedBy: { token: string; pid: number; home: string } }).servedBy;
}

describe('Okta MCP gateway', () => {
  it('rejects requests without a valid token', async () => {
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: auth('nope') });
    expect(res.status).toBe(401);
  });

  it("rejects tokens about to expire, so Okta's server never tries its own sign-in", async () => {
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers: auth('token-expiring') });
    expect(res.status).toBe(401);
  });

  it('exposes only read-only tools, even when the token has a write scope', async () => {
    const client = await mcpClient('token-ada');
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(['list_users']);
    await client.close();
  });

  it('refuses to forward calls to write tools', async () => {
    const client = await mcpClient('token-ada');
    const result = await client.callTool({ name: 'delete_everything', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('read-only');
    await client.close();
  });

  it('runs a separate Okta MCP process per admin, each using only its own token', async () => {
    const [ada, bob] = await Promise.all([listUsersAs('token-ada'), listUsersAs('token-bob')]);
    expect(ada.token).toBe('token-ada');
    expect(bob.token).toBe('token-bob');
    expect(ada.pid).not.toBe(bob.pid);
    expect(ada.home).not.toBe(bob.home);
  });

  it("reuses an admin's process and picks up their renewed token without a restart", async () => {
    const before = await listUsersAs('token-ada');
    const after = await listUsersAs('token-ada-renewed');
    expect(after.pid).toBe(before.pid);
    expect(after.token).toBe('token-ada-renewed');
  });
});

describe('chat', () => {
  const chatId = 'chat-1';

  it('streams a reply that survives a client disconnect and can be resumed', async () => {
    const send = await fetch(`${base}/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { ...auth('token-ada'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          id: 'm1',
          role: 'user',
          metadata: { page },
          parts: [{ type: 'text', text: 'Who is locked out?' }],
        },
      }),
    });
    expect(send.status).toBe(200);

    // Read the first bit, then "navigate away".
    const reader = send.body!.getReader();
    await reader.read();
    await reader.cancel();

    // The new page resumes and gets the whole answer, replayed from the start.
    const resumed = await fetch(`${base}/api/chats/${chatId}/stream`, {
      headers: auth('token-ada'),
    });
    expect(resumed.status).toBe(200);
    const sse = await resumed.text();
    expect(sse).toContain('"type":"start"');
    expect(sse).toContain('tool-output-available');
    expect(sse).toContain('locked@example.com.');

    // Finished: nothing left to resume, and history has the full answer.
    const none = await fetch(`${base}/api/chats/${chatId}/stream`, { headers: auth('token-ada') });
    expect(none.status).toBe(204);

    const history = (await (
      await fetch(`${base}/api/chats/${chatId}`, { headers: auth('token-ada') })
    ).json()) as {
      running: boolean;
      messages: Array<{ role: string; parts: unknown[] }>;
    };
    expect(history.running).toBe(false);
    expect(history.messages).toHaveLength(2);
    const reply = history.messages[1]!;
    expect(reply.role).toBe('assistant');
    expect(JSON.stringify(reply.parts)).toContain('list_users');
    // The tool ran in Ada's own Okta MCP process, with Ada's token.
    expect(JSON.stringify(reply.parts)).toContain('token-ada');
    expect(JSON.stringify(reply.parts)).toContain('One user is locked out');
  });

  it('gives the model the page the question was asked from', async () => {
    const lastCall = model.doStreamCalls.at(-1)!;
    const firstUser = lastCall.prompt.find((m) => m.role === 'user');
    expect(JSON.stringify(firstUser)).toContain('<page_context>');
    expect(JSON.stringify(firstUser)).toContain('https://acme-admin.okta.com/admin/users');
  });

  it("doesn't let one admin read another admin's chat", async () => {
    const res = await fetch(`${base}/api/chats/${chatId}`, { headers: auth('token-bob') });
    expect(res.status).toBe(403);
  });

  it('stops a reply on request and frees the chat for the next message', async () => {
    const id = 'chat-stop';
    const send = (text: string) =>
      fetch(`${base}/api/chats/${id}/messages`, {
        method: 'POST',
        headers: { ...auth('token-ada'), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] },
        }),
      });

    const first = await send('Who is locked out?');
    await first.body!.getReader().read();
    const stop = await fetch(`${base}/api/chats/${id}/stop`, {
      method: 'POST',
      headers: auth('token-ada'),
    });
    expect(stop.status).toBe(204);
    await first.text().catch(() => undefined);

    // The run ends and the chat accepts the next message.
    await vi.waitFor(async () => {
      const res = await fetch(`${base}/api/chats/${id}`, { headers: auth('token-ada') });
      expect(((await res.json()) as { running: boolean }).running).toBe(false);
    });
    const second = await send('Thanks');
    expect(second.status).toBe(200);
    await second.text();
  });
});
