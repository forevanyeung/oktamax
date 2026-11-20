/**
 * Usage telemetry for the assistant: one JSON line on stdout per reply (`llm.chat.turn`) and
 * per tool call (`llm.tool.call`), for a log pipeline such as Datadog's to facet and graph.
 *
 * Counts, sizes and timings only. Never message text, page content, tool inputs or outputs,
 * or error messages. Admins, orgs and chats appear only as keyed hashes (HMAC with
 * TELEMETRY_SECRET): stable enough to count distinct users and group a chat's turns, and not
 * reversible without the secret, unlike a plain hash of a guessable Okta user ID.
 *
 * Attribute names follow Datadog's standard ones where there is one (`evt.name`,
 * `evt.outcome`, `usr.id`); the rest are under `llm.*`.
 */
import { createHmac, randomBytes } from 'node:crypto';

import type { LanguageModelUsage } from 'ai';

import { principalKey, type Principal } from './auth';
import { config } from './config';

export type TelemetryEvent = Record<string, unknown> & {
  message: string;
  evt: { name: string; outcome?: string };
};

/** Where events go. Tests pass their own; the server writes JSON lines to stdout. */
export type TelemetrySink = (event: TelemetryEvent) => void;

const stdoutSink: TelemetrySink = (event) => {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
};

export const defaultTelemetrySink: TelemetrySink = config.telemetry.enabled ? stdoutSink : () => {};

// Without TELEMETRY_SECRET, hashes are stable only until the server restarts.
const secret = config.telemetry.secret ?? randomBytes(32);

/** A pseudonymous ID for `value`: the same for the same value, meaningless without the secret. */
export const anonId = (value: string) =>
  createHmac('sha256', secret).update(value).digest('hex').slice(0, 16);

/** The parts of a model step (an AI SDK `StepResult`) that telemetry reads. */
interface Step {
  model: { provider: string; modelId: string };
  usage: LanguageModelUsage;
  finishReason: string;
  toolCalls: ReadonlyArray<{ toolName: string }>;
  performance?: { timeToFirstOutputMs?: number | undefined };
}

interface ToolEnd {
  toolCall: { toolName: string };
  toolExecutionMs: number;
  toolOutput: { type: string; output?: unknown };
}

export interface ChatTurn {
  principal: Principal;
  chatId: string;
  /** `question`: the admin asked something. `console_result`: the extension ran an API console call. */
  kind: 'question' | 'console_result';
  /** The chat's messages before the reply, including the one just sent. */
  messages: ReadonlyArray<{ role: string; parts: ReadonlyArray<{ type: string; text?: string }> }>;
  /** Whether the admin's message came with the page it was asked from. */
  pageContext: boolean;
  /** Tools the extension runs (the rest come from Okta's MCP server). */
  pageTools: ReadonlySet<string>;
}

const sum = (values: Array<number | undefined>) => values.reduce<number>((a, b) => a + (b ?? 0), 0);

/** The name of an error's class and its HTTP status, if any: never its message. */
function errorKind(error: unknown) {
  if (!(error instanceof Error)) return { type: typeof error };
  const status = (error as { statusCode?: unknown }).statusCode;
  return { type: error.name, ...(typeof status === 'number' && { status }) };
}

/**
 * `streamText` callbacks that report one reply: an `llm.chat.turn` event when it completes,
 * is stopped, or fails, and an `llm.tool.call` event per tool the server runs.
 */
export function trackChatTurn(turn: ChatTurn, sink: TelemetrySink = defaultTelemetrySink) {
  const started = performance.now();
  const ids = {
    usr: { id: anonId(principalKey(turn.principal)) },
    org: anonId(turn.principal.org.host),
    chat_id: anonId(`${turn.principal.org.host}/${turn.chatId}`),
  };
  const toolSource = (name: string) => (turn.pageTools.has(name) ? 'page' : 'mcp');
  const steps: Step[] = [];
  let reported = false;

  function report(outcome: 'completed' | 'aborted' | 'error', error?: unknown) {
    if (reported) return;
    reported = true;
    const last = steps.at(-1);
    const toolNames = steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    const latest = turn.messages.at(-1);
    try {
      sink({
        message: `llm chat turn ${outcome}`,
        evt: { name: 'llm.chat.turn', outcome },
        usr: ids.usr,
        llm: {
          org: ids.org,
          chat_id: ids.chat_id,
          kind: turn.kind,
          model: last && { provider: last.model.provider, id: last.model.modelId },
          // Where the chat is: how many questions so far, and how long the history is.
          turn: turn.messages.filter((m) => m.role === 'user').length,
          history_messages: turn.messages.length,
          prompt_chars:
            turn.kind === 'question' && latest
              ? sum(latest.parts.map((p) => (p.type === 'text' ? p.text?.length : 0)))
              : 0,
          page_context: turn.pageContext,
          steps: steps.length,
          finish_reason: last?.finishReason,
          duration_ms: Math.round(performance.now() - started),
          time_to_first_output_ms: steps[0]?.performance?.timeToFirstOutputMs,
          tokens: {
            input: sum(steps.map((s) => s.usage.inputTokens)),
            output: sum(steps.map((s) => s.usage.outputTokens)),
            cache_read: sum(steps.map((s) => s.usage.inputTokenDetails?.cacheReadTokens)),
            cache_write: sum(steps.map((s) => s.usage.inputTokenDetails?.cacheWriteTokens)),
            reasoning: sum(steps.map((s) => s.usage.outputTokenDetails?.reasoningTokens)),
          },
          // Every step resends the whole conversation, so the last step's input is the
          // context the reply ended with (summing steps would count it again each time).
          context_tokens: last?.usage.inputTokens ?? 0,
          tools: {
            calls: toolNames.length,
            names: [...new Set(toolNames)],
            mcp_calls: toolNames.filter((n) => toolSource(n) === 'mcp').length,
            page_calls: toolNames.filter((n) => toolSource(n) === 'page').length,
          },
          ...(error !== undefined && { error: errorKind(error) }),
        },
      });
    } catch (e) {
      console.error('[telemetry]', e);
    }
  }

  return {
    onStepEnd: (step: Step) => {
      steps.push(step);
    },
    onToolExecutionEnd: ({ toolCall, toolExecutionMs, toolOutput }: ToolEnd) => {
      // MCP tools report their own failures in the result rather than throwing.
      const failed =
        toolOutput.type === 'tool-error' ||
        (toolOutput.output as { isError?: unknown } | undefined)?.isError === true;
      const outcome = failed ? 'error' : 'ok';
      try {
        sink({
          message: `llm tool call ${outcome}`,
          evt: { name: 'llm.tool.call', outcome },
          usr: ids.usr,
          llm: {
            org: ids.org,
            chat_id: ids.chat_id,
            tool: {
              name: toolCall.toolName,
              source: toolSource(toolCall.toolName),
              duration_ms: Math.round(toolExecutionMs),
            },
          },
        });
      } catch (e) {
        console.error('[telemetry]', e);
      }
    },
    onEnd: () => report('completed'),
    onAbort: () => report('aborted'),
    onError: ({ error }: { error: unknown }) => report('error', error),
  };
}
