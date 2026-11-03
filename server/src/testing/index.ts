/**
 * Test doubles shared by the server tests and the extension's end-to-end test:
 * a fake Okta org (at the fetch layer) and a scripted model in place of Bedrock.
 */
import type { LanguageModelV4Prompt, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { fileURLToPath } from 'node:url';

import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

import { config } from '../config';
import { OktaMcpProcessPool } from '../mcp/processPool';

export const TEST_ORG = 'https://acme.okta.com';
export const TEST_CLIENT_ID = '0oatestclient';
/** A second org on the same server (OKTA_ORGS in the tests). Its admins' tokens start with `other-`. */
export const OTHER_ORG = 'https://other.okta.com';
export const OTHER_CLIENT_ID = '0oaotherclient';
const READ = 'okta.users.read okta.groups.read';
/** Access tokens the fake Okta accepts. `exp` is minutes from now. */
export const TEST_USERS: Record<
  string,
  { uid: string; username: string; scope: string; exp?: number }
> = {
  // Ada's token also has a write scope: the gateway must still never expose write tools.
  'token-ada': { uid: '00uada', username: 'ada@example.com', scope: `${READ} okta.users.manage` },
  'token-ada-renewed': {
    uid: '00uada',
    username: 'ada@example.com',
    scope: `${READ} okta.users.manage`,
  },
  'token-bob': { uid: '00ubob', username: 'bob@example.com', scope: READ },
  'token-expiring': { uid: '00ucat', username: 'cat@example.com', scope: READ, exp: 1 },
};

/**
 * Okta's sign-in codes and refresh tokens: each gives that user's token
 * (`okta-code-ada` and `refresh-ada` give `token-ada`).
 */
const tokenFor = (form: URLSearchParams) =>
  form.get('grant_type') === 'authorization_code'
    ? form.get('code')?.replace(/^okta-code-/, 'token-')
    : form.get('refresh_token')?.replace(/^refresh-/, 'token-');

/**
 * Route fetches to `TEST_ORG` and `OTHER_ORG` to a fake Okta; everything else goes
 * out for real. Returns the API calls made, and the token requests in `tokenRequests`.
 */
export function mockOkta(): string[] & { tokenRequests: URLSearchParams[] } {
  const calls = Object.assign([] as string[], { tokenRequests: [] as URLSearchParams[] });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== TEST_ORG && url.origin !== OTHER_ORG) return realFetch(input, init);
    const other = url.origin === OTHER_ORG;
    const clientId = other ? OTHER_CLIENT_ID : TEST_CLIENT_ID;
    const form = new URLSearchParams(String(init?.body));

    if (url.pathname === '/oauth2/v1/introspect') {
      const token = form.get('token') ?? '';
      // Each org only knows its own admins' tokens.
      const user =
        token.startsWith('other-') === other ? TEST_USERS[token.replace(/^other-/, '')] : undefined;
      if (!user || form.get('client_id') !== clientId) return Response.json({ active: false });
      const { exp = 60, ...claims } = user;
      return Response.json({
        active: true,
        client_id: clientId,
        exp: Math.floor(Date.now() / 1000) + exp * 60,
        ...claims,
      });
    }
    if (url.pathname === '/oauth2/v1/token') {
      calls.tokenRequests.push(form);
      const token = tokenFor(form);
      if (!token || !TEST_USERS[token] || form.get('client_id') !== clientId) {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      return Response.json({
        access_token: other ? `other-${token}` : token,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: TEST_USERS[token].scope,
        refresh_token: token.replace(/^token-/, 'refresh-'),
        id_token: 'not-for-clients',
      });
    }
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.pathname === '/api/v1/users') {
      return Response.json([
        { id: '00u1', profile: { login: 'locked@example.com' }, _links: { self: {} } },
      ]);
    }
    return Response.json({ errorSummary: 'Not found' }, { status: 404 });
  };
  return calls;
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

/** The tool the scripted model calls for a question, and how it then answers. */
const SCRIPTS: Array<{ when: RegExp; tool: string; input: object; answer: string }> = [
  {
    when: /\blogs\b/i,
    tool: 'open_in_api_console',
    input: { path: '/api/v1/logs?filter=eventType eq "user.authentication.sso"' },
    answer: 'I opened the sign-in logs in the API console.',
  },
  {
    when: /\bgo to\b/i,
    tool: 'navigate',
    input: { path: '/admin/groups' },
    answer: 'Here are your groups.',
  },
  {
    when: /./,
    tool: 'list_users',
    input: { search: 'status eq "LOCKED_OUT"' },
    answer: 'One user is locked out: locked@example.com.',
  },
];

const lastQuestion = (prompt: LanguageModelV4Prompt) => {
  const index = prompt.findLastIndex((m) => m.role === 'user');
  const content = prompt[index]?.content;
  const text = Array.isArray(content)
    ? content.map((part) => (part.type === 'text' ? part.text : '')).join('')
    : '';
  // Tool results since the question mean the lookup is done.
  return { text, answered: prompt.slice(index).some((m) => m.role === 'tool') };
};

/**
 * Step 1: call a tool picked from the question (`SCRIPTS`). Step 2: answer, one
 * word every `delayMs`, so tests can disconnect mid-answer.
 */
export const scriptedModel = (delayMs = 40) =>
  new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const question = lastQuestion(prompt);
      const script = SCRIPTS.find((s) => s.when.test(question.text))!;
      const words = script.answer.split(/(?<= )/);
      const chunks: LanguageModelV4StreamPart[] = question.answered
        ? [
            { type: 'text-start' as const, id: 't1' },
            ...words.map((delta) => ({ type: 'text-delta' as const, id: 't1', delta })),
            { type: 'text-end' as const, id: 't1' },
            {
              type: 'finish' as const,
              usage,
              finishReason: { unified: 'stop' as const, raw: 'end_turn' },
            },
          ]
        : [
            {
              type: 'tool-call' as const,
              toolCallId: crypto.randomUUID(),
              toolName: script.tool,
              input: JSON.stringify(script.input),
            },
            {
              type: 'finish' as const,
              usage,
              finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
            },
          ];
      return { stream: simulateReadableStream({ chunks, chunkDelayInMs: delayMs }) };
    },
  });

/** A process pool that runs the fake Okta MCP server instead of the real one. */
export const fakeOktaMcpPool = () =>
  new OktaMcpProcessPool({
    ...config.oktaMcp,
    command: process.execPath,
    args: [fileURLToPath(new URL('./fakeOktaMcpServer.ts', import.meta.url))],
  });
