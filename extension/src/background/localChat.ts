/**
 * The on-device assistant: the chat server's routes (`chatRoutes.ts`), answered
 * by Chrome's built-in model (Gemini Nano, through the Prompt API) with Okta's
 * MCP server running on Pyodide (`oktaMcp.ts`), which reads the org through the
 * admin console tab the chat is on. Nothing leaves the browser except those
 * Okta API calls, and there's nothing to set up: no server, no OIDC app.
 *
 * Nano gets a few simple tools from `guide.ts`, picked for each question, that
 * call okta-mcp-server's tools; see there why. Its context window is about
 * 6,000 tokens, so history and the page are trimmed, and it looks things up
 * once (twice if that fails) before it has to answer.
 */
import type { MCPClient } from '@ai-sdk/mcp';
import {
  convertToModelMessages,
  isStepCount,
  JsonToSseTransformStream,
  NoSuchToolError,
  streamText,
  toUIMessageStream,
  type StepResult,
  type TextStreamPart,
  type ToolSet,
} from 'ai';

import type { PageContext } from '@oktamax/shared';
import { PAGE_TOOLS } from '@oktamax/shared/pageTools';
import { StreamBuffer } from '@oktamax/shared/streamBuffer';

import { closeSession, onDeviceModel } from '../onDeviceModel';
import { serveChats, type Message, type StartReply } from './chatRoutes';
import { guideTools, routeTools, WRITE_REQUEST } from './guide';
import type { AdminTab } from './messages';
import { connectOktaMcp } from './oktaMcp';

const MAX_STEPS = 3;
const MAX_HISTORY = 6;
const MAX_PAGE_CHARS = 1_500;

const instructions = `You are an assistant in the Okta admin console, helping an Okta administrator understand their org's configuration. You can only read.
Look things up with the tools instead of guessing, and answer from what they return: name the users, groups, apps or policies, and give counts. A message may start with <page_context>, the page the admin is on; "this app" or "here" refers to it. Be concise; use Markdown.`;

/** For the step after a lookup: Nano tends to keep calling tools it no longer has. */
const ANSWER_NOW = `\nAnswer now, from the lookup results above. Don't call any tools.`;

const readOnlyInstructions = `${instructions}
The admin is asking you to change something. You can't change anything: say so, and tell them where in the admin console they can do it themselves.`;

/** Whether a step's lookup failed, so the model may try once more. */
const failed = (step: StepResult<ToolSet> | undefined) =>
  step?.content.some(
    (part) =>
      part.type === 'tool-error' ||
      (part.type === 'tool-result' && (part.output as { ok?: boolean } | undefined)?.ok === false),
  ) ?? false;

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

type Part = TextStreamPart<ToolSet>;

const textParts = (id: string, text: string): Part[] => [
  { type: 'text-start', id },
  { type: 'text-delta', id, text },
  { type: 'text-end', id },
];

/** How @browser-ai/core has the model write a tool call. */
const TOOL_CALL_FENCE = '```tool_call';

/** The call a tool part belongs to. */
const callId = (part: Part) =>
  part.type === 'tool-input-start' ||
  part.type === 'tool-input-delta' ||
  part.type === 'tool-input-end'
    ? part.id
    : part.type === 'tool-call' || part.type === 'tool-result' || part.type === 'tool-error'
      ? part.toolCallId
      : undefined;

/**
 * The reply, with what Nano gets wrong tidied up:
 * - calls to tools it wasn't offered are left out. On the answer step it often
 *   writes another tool call instead of an answer, which only fails.
 * - for a change request, it starts by saying the assistant can't make changes.
 * - if it looked something up but wrote no answer, the lookup's summary is the answer.
 * - a tool call it wrote but got wrong (it sometimes echoes the tool's schema) isn't
 *   shown as text; with no answer at all, it says it couldn't look that up.
 */
async function* withFallbacks(stream: AsyncIterable<Part>, changeRequest: boolean) {
  let summary: string | undefined;
  let answered = false;
  // A call's parts are held until it has a result, then sent, or dropped if the tool wasn't offered.
  const calls = new Map<string, Part[]>();
  // Text blocks are held until they show whether they're a botched tool call.
  const texts = new Map<string, { parts: Part[]; text: string }>();
  for await (const part of stream) {
    if (part.type === 'text-start') {
      texts.set(part.id, { parts: [part], text: '' });
      continue;
    }
    const held = 'id' in part ? texts.get(part.id) : undefined;
    if (held && (part.type === 'text-delta' || part.type === 'text-end')) {
      held.parts.push(part);
      if (part.type === 'text-delta') held.text += part.text;
      const start = held.text.trimStart();
      // Too short to tell yet.
      if (TOOL_CALL_FENCE.startsWith(start) && part.type !== 'text-end') continue;
      // A tool call it got wrong: left out.
      if (start.startsWith(TOOL_CALL_FENCE)) {
        if (part.type === 'text-end') texts.delete(part.id);
        continue;
      }
      texts.delete(part.id);
      if (held.text.trim()) answered = true;
      yield* held.parts;
      continue;
    }
    if (part.type === 'text-delta' && part.text.trim()) answered = true;
    const id = callId(part);
    if (id !== undefined && part.type !== 'tool-result' && part.type !== 'tool-error') {
      calls.set(id, [...(calls.get(id) ?? []), part]);
      continue;
    }
    if (part.type === 'tool-error' && NoSuchToolError.isInstance(part.error)) {
      calls.delete(part.toolCallId);
      continue;
    }
    if (id !== undefined) {
      yield* calls.get(id) ?? [];
      calls.delete(id);
    }
    if (part.type === 'finish' && !answered) {
      yield* textParts(
        'fallback',
        summary ?? "Sorry, I couldn't look that up. Try asking another way.",
      );
    }
    yield part;
    if (part.type === 'start' && changeRequest) {
      yield* textParts('read-only', "I can only read your org, so I can't make that change.\n\n");
    }
    if (part.type === 'tool-result') {
      summary = (part.output as { summary?: string }).summary;
      answered = false;
    }
  }
}

/** True once a page tool has run: the page is changing, so there's nothing more to say. */
const openedPage = ({ steps }: { steps: Array<StepResult<ToolSet>> }) =>
  steps
    .at(-1)
    ?.toolResults.some(
      (r) =>
        (PAGE_TOOLS as readonly string[]).includes(r.toolName) &&
        (r.output as { ok?: boolean }).ok === true,
    ) ?? false;

export function createLocalChat() {
  const start: StartReply<AdminTab> = (messages, save, tab) => {
    const abort = new AbortController();
    let mcp: MCPClient | undefined;
    // @browser-ai/core keeps one Prompt API session per model, and each step sends the
    // whole conversation: a model per step keeps it from piling up twice. Each step's
    // session is closed once the next starts, and the last when the reply ends.
    const models: Array<ReturnType<typeof onDeviceModel>> = [];
    const nextModel = () => {
      models.forEach(closeSession);
      models.push(onDeviceModel());
      return models.at(-1)!;
    };

    const result = (async () => {
      const started = performance.now();
      mcp = await connectOktaMcp(tab);
      console.debug(`[on-device] MCP connected in ${Math.round(performance.now() - started)} ms`);
      const last = messages.at(-1)!;
      const question = questionText(last);
      const page = last.metadata?.page;
      const mcpTools = await mcp.tools();
      console.debug(
        `[on-device] MCP tools listed at ${Math.round(performance.now() - started)} ms`,
      );
      const tools = guideTools(mcpTools, page, question);
      const offered = routeTools(question, page);
      const changeRequest = WRITE_REQUEST.test(question);
      const base = changeRequest ? readOnlyInstructions : instructions;

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

      const reply = streamText({
        model: nextModel(),
        instructions: base,
        messages: await convertToModelMessages(recent, { ignoreIncompleteToolCalls: true }),
        tools,
        stopWhen: [isStepCount(MAX_STEPS), openedPage],
        prepareStep: ({ stepNumber, steps }) => {
          // Look up first; after a lookup, answer (one more try if it failed).
          const lookUp = stepNumber === 0 || (stepNumber === 1 && failed(steps.at(-1)));
          return {
            model: stepNumber === 0 ? models.at(-1)! : nextModel(),
            activeTools: lookUp ? offered : [],
            instructions: lookUp ? base : base + ANSWER_NOW,
          };
        },
        abortSignal: abort.signal,
      });
      return { reply, changeRequest };
    })();

    const stream = toUIMessageStream({
      stream: new ReadableStream({
        async start(controller) {
          try {
            const { reply, changeRequest } = await result;
            for await (const part of withFallbacks(reply.stream, changeRequest)) {
              controller.enqueue(part);
            }
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
        models.forEach(closeSession);
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
