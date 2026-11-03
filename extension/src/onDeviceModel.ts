/** Chrome's built-in model (Gemini Nano, through the Prompt API), for the on-device assistant. */
import { browserAI } from '@browser-ai/core';

export const onDeviceModel = () => browserAI();

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
