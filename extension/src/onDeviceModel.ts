/** Chrome's built-in model (Gemini Nano, through the Prompt API), for the on-device assistant. */
import { browserAI } from '@browser-ai/core';

export const onDeviceModel = () => browserAI();
