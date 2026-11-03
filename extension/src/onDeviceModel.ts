/** Chrome's built-in model (Gemini Nano, through the Prompt API), for the on-device assistant. */
import { browserAI } from '@browser-ai/core';

/** The assistant reads and answers in English; without it, Chrome warns on every request. */
const ENGLISH = [{ type: 'text' as const, languages: ['en'] }];

export const onDeviceModel = () =>
  browserAI('text', { expectedInputs: ENGLISH, expectedOutputs: ENGLISH });

type OnDeviceModel = ReturnType<typeof onDeviceModel>;

/**
 * Closes the Prompt API session a model opened. @browser-ai/core keeps it in a
 * private field and never closes it, so every step's session would stay open
 * for as long as the service worker runs.
 */
export const closeSession = (model: OnDeviceModel) =>
  (
    model as unknown as { sessionManager?: { destroySession(): void } }
  ).sessionManager?.destroySession();
