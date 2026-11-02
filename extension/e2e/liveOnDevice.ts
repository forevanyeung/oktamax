/**
 * Live check of the on-device assistant against a real org: signs in as the
 * read-only admin, turns the assistant on (its only setting), and asks a
 * question that runs okta-mcp-server's list_users through the admin console
 * tab. The model is a scripted stand-in for Gemini Nano, as in `onDevice.ts`
 * (Playwright's Chromium doesn't have it); everything else is real.
 *
 * Run: vp build && vpx e2e/liveOnDevice.ts
 */
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';

import { adminUrl, launch, signIn } from './okta';

/**
 * Stands in for `LanguageModel`: picks `call.name`, calls it with `call.arguments`, then
 * reports how much came back.
 */
function installScriptedModel(call: { name: string; arguments: object }) {
  const reply = (messages: Array<{ content: unknown }>, constrained: boolean) => {
    const all = JSON.stringify(messages);
    if (constrained) return JSON.stringify({ tools: [call.name] });
    if (all.includes('tool_result')) return `Okta answered with ${all.length} characters.`;
    return `\`\`\`tool_call\n${JSON.stringify(call)}\n\`\`\``;
  };
  class Session {
    contextWindow = 6144;
    inputQuota = 6144;
    contextUsage = 0;
    inputUsage = 0;
    addEventListener() {}
    destroy() {}
    async prompt(
      messages: Array<{ content: unknown }>,
      options?: { responseConstraint?: unknown },
    ) {
      return reply(messages, !!options?.responseConstraint);
    }
    promptStreaming(messages: Array<{ content: unknown }>) {
      const text = reply(messages, false);
      return new ReadableStream<string>({
        start(controller) {
          controller.enqueue(text);
          controller.close();
        },
      });
    }
  }
  Object.assign(globalThis, {
    LanguageModel: {
      availability: async () => 'available',
      params: async () => ({ defaultTemperature: 1, defaultTopK: 3, maxTopK: 8 }),
      create: async () => new Session(),
    },
  });
}

const context = await launch('read');
const page = await signIn(context, 'read');
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
worker.on('console', (m) => console.log(`[worker ${m.type()}]`, m.text()));
// The tool to call, e.g. TOOL=get_logs ARGS='{"limit": 20}'; list_users by default.
const call = {
  name: process.env.TOOL ?? 'list_users',
  arguments: JSON.parse(process.env.ARGS ?? '{"limit": 20}') as object,
};
await worker.evaluate(installScriptedModel, call);
await worker.evaluate(() => chrome.storage.sync.set({ assistant: 'onDevice' }));

page.on('console', (m) => m.type() === 'error' && console.log('[page error]', m.text()));
await page.goto(`${adminUrl}${process.env.PAGE ?? '/admin/users'}`);
const panel = page.getByRole('dialog', { name: 'Okta assistant' });
// The panel stays open across runs (the profile is kept).
await page
  .getByRole('button', { name: 'Open Okta assistant' })
  .or(panel)
  .first()
  .waitFor({ timeout: 30_000 });
if (!(await panel.isVisible())) {
  await page.getByRole('button', { name: 'Open Okta assistant' }).click();
}
await panel.getByText('On-device').waitFor();
const newChat = panel.getByRole('button', { name: 'New chat' });
if (await newChat.isVisible()) await newChat.click();

const started = Date.now();
const input = panel.getByPlaceholder('Ask about this org…');
await input.fill('Who are some users?');
await input.press('Enter');
const answer = panel.getByText(/Okta answered|failed|closed/i).first();
await answer.waitFor({ timeout: 120_000 }).catch(() => {});
console.log(`After ${Date.now() - started} ms the panel says:\n${await panel.innerText()}`);
await page.screenshot({ path: resolve(import.meta.dirname, 'live-on-device.png') });

assert.ok(await panel.getByText('Okta answered').isVisible(), 'answered from the live org');
await context.close();
console.log('live on-device check passed');
