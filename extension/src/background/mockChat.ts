/**
 * A stand-in for the chat server in dev builds, used when no server is
 * reachable, so the chat UI can be worked on without Okta, Bedrock or a server.
 *
 * Serves the same routes as `server/src/chat/routes.ts`, with canned replies
 * that stream word by word, look things up, and know the page. It runs in the
 * service worker, so like the real server it keeps replying across page loads.
 * History is kept in `chrome.storage.local`.
 */
import {
  createUIMessageStream,
  JsonToSseTransformStream,
  UI_MESSAGE_STREAM_HEADERS,
  type UIMessage,
} from 'ai';

import type { ChatMessageMetadata, PageContext, SendMessageBody } from '@oktamax/shared';
import {
  checkPageTool,
  NAVIGATE,
  OPEN_IN_API_CONSOLE,
  PAGE_TOOLS,
} from '@oktamax/shared/pageTools';
import { StreamBuffer } from '@oktamax/shared/streamBuffer';

import type { BridgeRequest } from './messages';

type Message = UIMessage<ChatMessageMetadata>;

interface Lookup {
  tool: string;
  input: unknown;
  output: unknown;
}

/** A page tool call; its output comes from the same checks as the server's. */
const pageTool = (tool: string, path: string): Lookup => ({
  tool,
  input: { path },
  output: checkPageTool(tool, { path }),
});

interface Reply {
  lookups?: Lookup[];
  text: string;
  /** Fail after the text, like a model error. */
  error?: string;
}

const WORD_MS = 25;
const LOOKUP_MS = 800;

const APPS = [
  { id: '0oa1acmesaml00000001', label: 'Acme SAML', signOnMode: 'SAML_2_0', mfa: false },
  { id: '0oa1expenses00000002', label: 'Expenses', signOnMode: 'OPENID_CONNECT', mfa: true },
  { id: '0oa1wiki0000000000003', label: 'Team Wiki', signOnMode: 'BOOKMARK', mfa: false },
];

const LONG_TEXT = `## Global Session Policy

The **Default Policy** applies to everyone, with two rules above the default one:

1. **Admins**: MFA every session, sessions last at most 2 hours.
2. **Contractors**: MFA every session, no persistent cookies.
3. **Default Rule**: MFA once per device, 12-hour sessions.

| Rule | Applies to | MFA | Max session |
| --- | --- | --- | --- |
| Admins | Okta Admins | Every sign-in | 2 hours |
| Contractors | Contractors | Every sign-in | 8 hours |
| Default Rule | Everyone | Once per device | 12 hours |

To check a rule yourself:

\`\`\`
GET /api/v1/policies?type=OKTA_SIGN_ON
GET /api/v1/policies/{policyId}/rules
\`\`\`

- Rules are evaluated top to bottom; the first match wins.
- \`Default Rule\` can't be deleted or reordered.

> This is a mock reply, made up to show how long answers lay out.`;

function reply(question: string, page: PageContext | undefined): Reply {
  if (/\b(error|fail)/i.test(question)) {
    return {
      text: 'Let me look that up…',
      error: 'Something went wrong generating a response.',
    };
  }
  if (/\blogs?\b|sign-?ins?\b|signed in/i.test(question)) {
    const app = APPS.find((a) => page?.objectIds.includes(a.id)) ?? APPS[0]!;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const path = `/api/v1/logs?filter=eventType eq "user.authentication.sso" and target.id eq "${app.id}"&since=${today.toISOString()}`;
    return {
      lookups: [
        { tool: 'list_applications', input: { q: app.label }, output: [app] },
        pageTool(OPEN_IN_API_CONSOLE, path),
      ],
      text: `I opened today's sign-ins to **${app.label}** in the API console below: single sign-on events since midnight, newest last. Use **Table** to see one row per sign-in, or **Export CSV** to download them.`,
    };
  }
  if (/\b(go|take me|navigate|bring me)\b/i.test(question)) {
    return {
      lookups: [pageTool(NAVIGATE, '/admin/groups')],
      text: 'Here are your groups. Pick one to see its members and the apps assigned to it.',
    };
  }
  if (/lock/i.test(question)) {
    return {
      lookups: [
        {
          tool: 'list_users',
          input: { search: 'status eq "LOCKED_OUT"' },
          output: [{ id: '00u1locked0000000001', profile: { login: 'locked@example.com' } }],
        },
      ],
      text: 'One user is locked out: **locked@example.com**. They can unlock themselves with self-service unlock, or an admin with a write role can unlock them on their profile.',
    };
  }
  if (/mfa|app/i.test(question)) {
    const noMfa = APPS.filter((app) => !app.mfa);
    return {
      lookups: [
        { tool: 'list_applications', input: { filter: 'status eq "ACTIVE"' }, output: APPS },
        { tool: 'list_policies', input: { type: 'ACCESS_POLICY' }, output: [{ id: 'rst1' }] },
      ],
      text: [
        `${noMfa.length} of ${APPS.length} active apps don't require MFA:`,
        '',
        '| App | Sign-on | Access policy |',
        '| --- | --- | --- |',
        ...noMfa.map((app) => `| ${app.label} | ${app.signOnMode} | Password only |`),
        '',
        'Both use the **Default Policy**, whose catch-all rule allows password only.',
      ].join('\n'),
    };
  }
  if (/long|markdown|policy|policies/i.test(question)) return { text: LONG_TEXT };

  const where = page
    ? [
        `You're on **${page.title || page.url}**.`,
        page.headings.length ? `Headings: ${page.headings.map((h) => `“${h}”`).join(', ')}.` : '',
        page.objectIds.length
          ? `Okta IDs in the URL: ${page.objectIds.map((id) => `\`${id}\``).join(', ')}.`
          : '',
        page.selection ? `You selected: “${page.selection}”.` : '',
      ]
    : [];
  return {
    text: [
      ...where.filter(Boolean),
      '',
      "This is the **dev mock**: there's no chat server, so replies are canned. Try asking about *locked out* users, apps without *MFA*, to bring up today's *sign-ins*, to *go to* the groups page, for a *long* answer, or for an *error*.",
    ].join('\n'),
  };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

const STORAGE_KEY = 'mockChats';
const running = new Map<string, StreamBuffer>();

const loadChats = async () =>
  ((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] ?? {}) as Record<string, Message[]>;

const saveChat = async (id: string, messages: Message[]) =>
  chrome.storage.local.set({ [STORAGE_KEY]: { ...(await loadChats()), [id]: messages } });

const sse = (stream: ReadableStream<string>) =>
  new Response(stream.pipeThrough(new TextEncoderStream()), { headers: UI_MESSAGE_STREAM_HEADERS });

function start(chatId: string, messages: Message[]): StreamBuffer {
  const question = messages.at(-1)!;
  const text = question.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
  const answer = reply(text, question.metadata?.page);
  const abort = new AbortController();
  const { signal } = abort;

  const stream = createUIMessageStream<Message>({
    originalMessages: messages,
    generateId: () => crypto.randomUUID(),
    execute: async ({ writer }) => {
      writer.write({ type: 'start' });
      for (const [i, lookup] of (answer.lookups ?? []).entries()) {
        const toolCallId = `mock-${i}`;
        writer.write({ type: 'start-step' });
        // Okta's tools come from MCP (dynamic); the page tools are the server's own.
        const dynamic = !(PAGE_TOOLS as readonly string[]).includes(lookup.tool);
        writer.write({
          type: 'tool-input-available',
          toolCallId,
          toolName: lookup.tool,
          input: lookup.input,
          dynamic,
        });
        await sleep(LOOKUP_MS, signal);
        if (signal.aborted) return writer.write({ type: 'abort' });
        writer.write({ type: 'tool-output-available', toolCallId, output: lookup.output, dynamic });
        writer.write({ type: 'finish-step' });
      }
      writer.write({ type: 'start-step' });
      writer.write({ type: 'text-start', id: 'text' });
      for (const delta of answer.text.split(/(?<=\s)/)) {
        await sleep(WORD_MS, signal);
        if (signal.aborted) return writer.write({ type: 'abort' });
        writer.write({ type: 'text-delta', id: 'text', delta });
      }
      writer.write({ type: 'text-end', id: 'text' });
      writer.write({ type: 'finish-step' });
      if (answer.error) writer.write({ type: 'error', errorText: answer.error });
      else writer.write({ type: 'finish' });
    },
    onEnd: async ({ messages: final }) => {
      await saveChat(chatId, final);
      running.delete(chatId);
    },
  });

  return new StreamBuffer(stream.pipeThrough(new JsonToSseTransformStream()), abort);
}

/** Answers a chat request the way the chat server would. */
export async function mockChat(request: BridgeRequest): Promise<Response> {
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
    const buffer = start(chatId, messages);
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
}
