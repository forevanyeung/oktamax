/**
 * The on-device assistant: the chat server's routes (`chatRoutes.ts`), answered
 * by Chrome's built-in model (Gemini Nano, through the Prompt API) with Okta's
 * MCP server running on Pyodide (`oktaMcp.ts`). Nothing leaves the browser
 * except the Okta API calls themselves.
 *
 * Gemini Nano has a context window of about 6,000 tokens, and Okta's read tools
 * alone take about 17,000. So each question first picks a couple of tools from
 * a one-line list, and only those are offered, with short descriptions; tool
 * results, history and the page context are trimmed to fit.
 */
import type { MCPClient } from '@ai-sdk/mcp';
import {
  convertToModelMessages,
  dynamicTool,
  generateText,
  isStepCount,
  jsonSchema,
  JsonToSseTransformStream,
  Output,
  streamText,
  tool,
  toUIMessageStream,
  type Tool,
  type ToolSet,
} from 'ai';

import type { PageContext } from '@oktamax/shared';
import {
  checkApiPath,
  checkAdminPath,
  NAVIGATE,
  OPEN_IN_API_CONSOLE,
} from '@oktamax/shared/pageTools';
import { StreamBuffer } from '@oktamax/shared/streamBuffer';

import { onDeviceModel } from '../onDeviceModel';
import type { AuthConfig } from './auth';
import { serveChats, type Message, type StartReply } from './chatRoutes';
import { connectOktaMcp, isReadOnlyTool } from './oktaMcp';

const MAX_TOOLS = 2;
const MAX_STEPS = 4;
const MAX_HISTORY = 6;
const MAX_TOOL_RESULT_CHARS = 4_000;
const MAX_PAGE_CHARS = 1_500;

const instructions = `You are an assistant in the Okta admin console, helping an Okta administrator understand their org's configuration. You can only read: if asked to change something, say where in the admin console to do it.
Look things up with the tools instead of guessing. Okta IDs (00u… users, 00g… groups, 0oa… apps) can be passed to tools. A message may start with <page_context>, the page the admin is on; "this app" or "here" refers to it. Be concise; use Markdown.`;

const pathInput = jsonSchema<{ path: string }>({
  type: 'object',
  properties: { path: { type: 'string' } },
  required: ['path'],
});

/** The chat server's page tools (`server/src/chat/pageTools.ts`), with shorter descriptions. */
const pageTools = {
  [OPEN_IN_API_CONSOLE]: tool({
    description:
      'Open a GET request in the API console at the bottom of the page, for "show me" or "bring up" requests. path: e.g. /api/v1/users?search=status eq "LOCKED_OUT"',
    inputSchema: pathInput,
    execute: async ({ path }) => checkApiPath(path),
  }),
  [NAVIGATE]: tool({
    description:
      'Take the admin to an admin console page, e.g. /admin/users, /admin/groups, /admin/apps/active, /admin/user/profile/view/{userId}, /admin/group/{groupId}.',
    inputSchema: pathInput,
    execute: async ({ path }) => checkAdminPath(path),
  }),
} satisfies ToolSet;

/** The first paragraph of a tool's description: Okta's run to a page or more. */
const summary = (description = '') =>
  description
    .split(/\n\s*\n/)[0]!
    .trim()
    .slice(0, 300);

interface OktaTool {
  /** First sentence of the description, for picking tools. */
  brief: string;
  tool: Tool;
}

/** Okta's read tools, with short descriptions and results cut to fit the context window. */
async function oktaTools(mcp: MCPClient): Promise<Record<string, OktaTool>> {
  const tools: Record<string, OktaTool> = {};
  for (const [name, mcpTool] of Object.entries(await mcp.tools())) {
    if (!isReadOnlyTool(name)) continue;
    const description = summary(mcpTool.description as string | undefined);
    tools[name] = {
      brief: description.split(/(?<=\.)\s/)[0]!,
      tool: dynamicTool({
        description,
        inputSchema: mcpTool.inputSchema,
        execute: async (input, options) => {
          const result = (await mcpTool.execute!(input as never, options)) as {
            content?: Array<{ type: string; text?: string }>;
          };
          const text = (result.content ?? []).map((c) => c.text ?? '').join('\n');
          return text.length > MAX_TOOL_RESULT_CHARS
            ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n… (truncated; use filters or a smaller limit)`
            : text;
        },
      }),
    };
  }
  return tools;
}

const describePage = (page: PageContext) =>
  [
    '<page_context>',
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    page.headings.length > 0 && `Headings: ${page.headings.join(' › ')}`,
    page.objectIds.length > 0 && `Object IDs: ${page.objectIds.join(', ')}`,
    page.selection && `Selected: ${page.selection}`,
    `Visible text:\n${page.text.slice(0, MAX_PAGE_CHARS)}`,
    '</page_context>',
  ]
    .filter(Boolean)
    .join('\n');

const questionText = (message: Message) =>
  message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');

/** The few Okta tools this question needs, chosen by the model from a one-line list. */
async function pickTools(
  tools: Record<string, OktaTool>,
  message: Message,
  abortSignal: AbortSignal,
) {
  const names = Object.keys(tools);
  const page = message.metadata?.page;
  const { output } = await generateText({
    model: onDeviceModel(),
    abortSignal,
    output: Output.object({
      schema: jsonSchema<{ tools: string[] }>({
        type: 'object',
        properties: {
          tools: { type: 'array', items: { type: 'string', enum: names }, maxItems: MAX_TOOLS },
        },
        required: ['tools'],
      }),
    }),
    prompt: [
      `Pick up to ${MAX_TOOLS} tools needed to answer an Okta admin's question (none if no lookup is needed).`,
      '',
      ...names.map((name) => `- ${name}: ${tools[name]!.brief}`),
      '',
      ...(page ? [`The admin is on: ${page.title} (${page.url})`] : []),
      `Question: ${questionText(message)}`,
    ].join('\n'),
  });
  return output.tools.filter((name) => names.includes(name)).slice(0, MAX_TOOLS);
}

export function createLocalChat(getConfig: () => Promise<{ config: AuthConfig; token: string }>) {
  const start: StartReply = (messages, save) => {
    const abort = new AbortController();
    let mcp: MCPClient | undefined;

    const result = (async () => {
      const { config, token } = await getConfig();
      mcp = await connectOktaMcp(config, token);
      const okta = await oktaTools(mcp);
      const chosen = await pickTools(okta, messages.at(-1)!, abort.signal);

      // Only the latest message carries its page: older ones' would crowd out the answer.
      const recent = messages.slice(-MAX_HISTORY).map((message, i, all) =>
        i === all.length - 1 && message.metadata?.page
          ? {
              ...message,
              parts: [
                { type: 'text' as const, text: describePage(message.metadata.page) },
                ...message.parts,
              ],
            }
          : message,
      );

      return streamText({
        model: onDeviceModel(),
        instructions,
        messages: await convertToModelMessages(recent, { ignoreIncompleteToolCalls: true }),
        tools: {
          ...Object.fromEntries(chosen.map((name) => [name, okta[name]!.tool])),
          ...pageTools,
        },
        stopWhen: isStepCount(MAX_STEPS),
        // @browser-ai/core keeps one Prompt API session per model, and each step sends
        // the whole conversation: a fresh model per step keeps it from piling up twice.
        prepareStep: () => ({ model: onDeviceModel() }),
        abortSignal: abort.signal,
      });
    })();

    const stream = toUIMessageStream({
      stream: new ReadableStream({
        async start(controller) {
          try {
            for await (const part of (await result).stream) controller.enqueue(part);
          } catch (error) {
            controller.enqueue({ type: 'error', error });
          }
          controller.close();
        },
      }),
      originalMessages: messages,
      generateMessageId: () => crypto.randomUUID(),
      sendReasoning: false,
      onEnd: async ({ messages: final }) => {
        await save(final);
        await mcp?.close();
      },
      onError: (error) => {
        console.error('[on-device chat]', error);
        return error instanceof Error ? error.message : String(error);
      },
    });

    return new StreamBuffer(stream.pipeThrough(new JsonToSseTransformStream()), abort);
  };

  return serveChats('localChats', start);
}
