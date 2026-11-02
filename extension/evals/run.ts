/**
 * Evals for the on-device assistant: real Gemini Nano in Google Chrome, real
 * okta-mcp-server on Pyodide, the live org from the repo's `.env` (as the
 * read-only admin). Asks each question in `cases.ts` in the chat panel, then
 * scores the tools it used and the facts in its answer, and times the model.
 *
 * The first run downloads Chrome's model into the eval profile (a few GB, once).
 * Results go to evals/results/<time>.json.
 *
 * Run: npm run build && npm run evals [-- case-id ...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BrowserContext, Page, Worker } from 'playwright';

import type { Message } from '../src/background/chatRoutes';
import { adminUrl, signIn } from '../e2e/okta';
import { cases, type Api, type Case, type Fact } from './cases';
import { launchChrome, userDataDir } from './chrome';

const ANSWER_TIMEOUT_MS = 240_000;
const DOWNLOAD_TIMEOUT_MS = 60 * 60_000;

/** One Prompt API call, as timed in the service worker. */
interface ModelCall {
  kind: 'prompt' | 'json' | 'stream';
  /** Characters sent, including the session's initial prompts. */
  chars: number;
  /** Tokens in the session's context afterwards, where Chrome reports it. */
  tokens?: number;
  ms: number;
  /** Streaming: time to the first chunk. */
  firstMs?: number;
}

interface Result {
  id: string;
  question: string;
  page: string;
  pass: boolean;
  problems: string[];
  tools: Array<{ tool: string; input: unknown; error?: string }>;
  answer: string;
  facts: { expected: Fact[]; missing: Fact[] };
  ms: number;
  modelMs: number;
  modelCalls: ModelCall[];
}

/** Times every Prompt API call the extension makes. Runs in the service worker. */
function installMetrics() {
  type Session = {
    contextUsage?: number;
    inputUsage?: number;
    prompt(input: unknown, options?: { responseConstraint?: unknown }): Promise<string>;
    promptStreaming(input: unknown, options?: object): ReadableStream<string>;
  };
  const g = globalThis as unknown as {
    oktamaxEval?: { calls: ModelCall[] };
    LanguageModel: { create(options?: { initialPrompts?: unknown }): Promise<Session> };
  };
  if (g.oktamaxEval) return;
  const calls: ModelCall[] = [];
  g.oktamaxEval = { calls };
  const create = g.LanguageModel.create.bind(g.LanguageModel);
  g.LanguageModel.create = async (options) => {
    const session = await create(options);
    const initial = JSON.stringify(options?.initialPrompts ?? []).length;
    const usage = () => session.contextUsage ?? session.inputUsage;
    const prompt = session.prompt.bind(session);
    session.prompt = async (input, promptOptions) => {
      const started = performance.now();
      const output = await prompt(input, promptOptions);
      calls.push({
        kind: promptOptions?.responseConstraint ? 'json' : 'prompt',
        chars: initial + JSON.stringify(input).length,
        tokens: usage(),
        ms: performance.now() - started,
      });
      return output;
    };
    const promptStreaming = session.promptStreaming.bind(session);
    session.promptStreaming = (input, promptOptions) => {
      const started = performance.now();
      // Recorded up front and updated per chunk: a step that ends in a tool call is
      // cancelled mid-stream, so the stream never finishes.
      const call: ModelCall = {
        kind: 'stream',
        chars: initial + JSON.stringify(input).length,
        ms: 0,
      };
      calls.push(call);
      return promptStreaming(input, promptOptions).pipeThrough(
        new TransformStream<string, string>({
          transform(chunk, controller) {
            call.ms = performance.now() - started;
            call.firstMs ??= call.ms;
            call.tokens = usage();
            controller.enqueue(chunk);
          },
        }),
      );
    };
    return session;
  };
}

async function extensionWorker(context: BrowserContext, id: string) {
  const find = () => context.serviceWorkers().find((w) => w.url().includes(id));
  return (
    find() ??
    (await context.waitForEvent('serviceworker', { predicate: (w) => w.url().includes(id) }))
  );
}

/** Downloads Chrome's model into the eval profile if it isn't there yet. */
async function ensureModel(worker: Worker, page: Page, extensionId: string) {
  const availability = () =>
    worker.evaluate(
      () =>
        (
          globalThis as unknown as { LanguageModel?: { availability(): Promise<string> } }
        ).LanguageModel?.availability().catch((e: unknown) => `error: ${String(e)}`) ??
        'no Prompt API',
    );
  let state = await availability();
  console.log(`Chrome's model: ${state}`);
  if (state === 'available') return;
  if (state === 'unavailable' || state.startsWith('error') || state === 'no Prompt API') {
    throw new Error(
      `Gemini Nano can't run in this Chrome (${state}); see chrome://on-device-internals`,
    );
  }

  // Chrome only starts the download from a click: the extension's model page has the button.
  await page.goto(`chrome-extension://${extensionId}/src/model/index.html`);
  const button = page.getByRole('button', { name: 'Download' });
  await button.waitFor();
  if (await button.isEnabled()) await button.click();
  const started = Date.now();
  while (state !== 'available') {
    if (Date.now() - started > DOWNLOAD_TIMEOUT_MS) throw new Error('Model download timed out');
    await page.waitForTimeout(10_000);
    state = await availability();
    const status = (
      await page
        .locator('main p')
        .nth(1)
        .innerText()
        .catch(() => '')
    ).trim();
    console.log(`  ${Math.round((Date.now() - started) / 1000)} s: ${state}. ${status}`);
  }
}

const textOf = (message: Message | undefined) =>
  (message?.parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('');

/** Tool calls in a reply: Okta's (dynamic) and the page tools. */
function toolCalls(message: Message | undefined) {
  return (message?.parts ?? []).flatMap((part) => {
    const p = part as { type: string; toolName?: string; input?: unknown; errorText?: string };
    if (p.type === 'dynamic-tool')
      return [{ tool: p.toolName!, input: p.input, error: p.errorText }];
    if (p.type.startsWith('tool-'))
      return [{ tool: p.type.slice(5), input: p.input, error: p.errorText }];
    return [];
  });
}

/** Asks `question` in the panel and waits for the reply to be saved. */
async function ask(page: Page, worker: Worker, question: string) {
  const panel = page.getByRole('dialog', { name: 'Okta assistant' });
  const launcher = page.getByRole('button', { name: 'Open Okta assistant' });
  await launcher.or(panel).first().waitFor({ timeout: 30_000 });
  if (!(await panel.isVisible())) await launcher.click();
  await panel.getByText('On-device').waitFor({ timeout: 15_000 });
  const newChat = panel.getByRole('button', { name: 'New chat' });
  if (await newChat.isVisible()) await newChat.click();

  await worker.evaluate(installMetrics);
  await worker.evaluate(() => {
    (globalThis as unknown as { oktamaxEval: { calls: unknown[] } }).oktamaxEval.calls.length = 0;
  });
  const input = panel.getByPlaceholder('Ask about this org…');
  await input.fill(question);
  const started = Date.now();
  await input.press('Enter');

  // Read the reply from the chat history (it survives the page navigating mid-answer).
  while (Date.now() - started < ANSWER_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 500));
    const chats = await worker.evaluate(
      async () =>
        ((await chrome.storage.local.get('localChats')).localChats ?? {}) as Record<
          string,
          Message[]
        >,
    );
    const chat = Object.values(chats).find((messages) => textOf(messages[0]) === question);
    const reply = chat?.at(-1);
    if (reply?.role === 'assistant') {
      const ms = Date.now() - started;
      const calls = await worker.evaluate(
        () => (globalThis as unknown as { oktamaxEval: { calls: ModelCall[] } }).oktamaxEval.calls,
      );
      return { reply, ms, calls };
    }
  }
  const shown = await panel.innerText().catch(() => '');
  throw new Error(
    `No answer within ${ANSWER_TIMEOUT_MS / 1000} s. The panel shows: ${shown.slice(-300)}`,
  );
}

async function runCase(test: Case, page: Page, worker: Worker, api: Api): Promise<Result> {
  const path = typeof test.page === 'string' ? test.page : await test.page(api);
  const expected = (await test.facts?.(api)) ?? [];
  await page.goto(`${adminUrl}${path}`, { waitUntil: 'domcontentloaded' });

  const problems: string[] = [];
  let answer = '';
  let tools: Result['tools'] = [];
  let ms = 0;
  let modelCalls: ModelCall[] = [];
  try {
    const { reply, ms: took, calls } = await ask(page, worker, test.question);
    answer = textOf(reply);
    tools = toolCalls(reply);
    ms = took;
    modelCalls = calls;
  } catch (error) {
    problems.push(String(error instanceof Error ? error.message : error));
  }

  const used = tools.map((t) => t.tool);
  if (test.tools.length > 0 && !test.tools.some((t) => used.includes(t))) {
    problems.push(`expected ${test.tools.join(' or ')}, used ${used.join(', ') || 'no tools'}`);
  }
  if (test.tools.length === 0 && used.length > 0) problems.push(`used ${used.join(', ')}`);
  for (const t of tools) if (t.error) problems.push(`${t.tool} failed: ${t.error.slice(0, 200)}`);
  const says = (text: string) => answer.toLowerCase().includes(text.toLowerCase());
  const missing = expected.filter((fact) => ![fact].flat().some(says));
  if (missing.length > 0) {
    problems.push(`missing ${missing.map((f) => [f].flat().join(' or ')).join(', ')}`);
  }
  for (const pattern of test.says ?? []) {
    if (!pattern.test(answer)) problems.push(`doesn't say ${pattern}`);
  }
  const callProblem = await test.calls?.(tools, api);
  if (callProblem) problems.push(callProblem);
  if (!answer.trim() && problems.length === 0) problems.push('empty answer');

  return {
    id: test.id,
    question: test.question,
    page: path,
    pass: problems.length === 0,
    problems,
    tools,
    answer,
    facts: { expected, missing },
    ms,
    modelMs: modelCalls.reduce((sum, c) => sum + c.ms, 0),
    modelCalls,
  };
}

const seconds = (ms: number) => (ms / 1000).toFixed(1);

async function main() {
  const only = process.argv.slice(2);
  const selected = only.length > 0 ? cases.filter((c) => only.includes(c.id)) : cases;
  if (selected.length === 0) throw new Error(`No cases named ${only.join(', ')}`);

  console.log(`Chrome profile: ${userDataDir}`);
  const evalChrome = await launchChrome();
  try {
    const page = await signIn(evalChrome.context, 'read');
    const worker = await extensionWorker(evalChrome.context, evalChrome.extensionId);
    await worker.evaluate(async () => {
      await chrome.storage.sync.set({ assistant: 'onDevice' });
      await chrome.storage.local.remove('localChats');
    });
    await ensureModel(worker, page, evalChrome.extensionId);

    await page.goto(`${adminUrl}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
    const api: Api = (path) =>
      page.evaluate(
        async (p) => (await fetch(p, { headers: { Accept: 'application/json' } })).json(),
        path,
      );

    const results: Result[] = [];
    for (const test of selected) {
      const result = await runCase(test, page, worker, api);
      results.push(result);
      const tools = result.tools.map((t) => t.tool).join(', ') || '-';
      console.log(
        `${result.pass ? 'PASS' : 'FAIL'}  ${test.id.padEnd(20)} ${seconds(result.ms).padStart(6)} s  ` +
          `(model ${seconds(result.modelMs)} s, ${result.modelCalls.length} calls)  tools: ${tools}`,
      );
      for (const problem of result.problems) console.log(`      ${problem}`);
    }

    const passed = results.filter((r) => r.pass).length;
    const times = results
      .filter((r) => r.ms > 0)
      .map((r) => r.ms)
      .sort((a, b) => a - b);
    const firstChunks = results.flatMap((r) =>
      r.modelCalls.flatMap((c) => (c.firstMs ? [c.firstMs] : [])),
    );
    const largest = Math.max(0, ...results.flatMap((r) => r.modelCalls.map((c) => c.tokens ?? 0)));
    console.log(
      `\n${passed}/${results.length} passed. Median answer ${seconds(times[Math.floor(times.length / 2)] ?? 0)} s, ` +
        `slowest ${seconds(times.at(-1) ?? 0)} s; median first streamed token ` +
        `${seconds(firstChunks.sort((a, b) => a - b)[Math.floor(firstChunks.length / 2)] ?? 0)} s; ` +
        `largest context ${largest} tokens.`,
    );

    const out = resolve(import.meta.dirname, 'results');
    mkdirSync(out, { recursive: true });
    const file = resolve(out, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify({ org: adminUrl, results }, null, 2));
    console.log(`Details: ${file}`);
  } finally {
    await evalChrome.close();
  }
}

await main();
