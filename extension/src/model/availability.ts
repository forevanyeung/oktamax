/**
 * Whether Chrome's built-in model (Gemini Nano) is ready, for the popup and the
 * download page. The model is Chrome's, not the extension's: it's downloaded once
 * for the browser and shared by every site and extension that uses it.
 */
import { useEffect, useState } from 'react';

import { onDeviceModel } from '../onDeviceModel';

/** The page that downloads the model: a tab, so the download outlives the popup. */
export const MODEL_PAGE = 'src/model/index.html';

export const openModelPage = () => chrome.tabs.create({ url: chrome.runtime.getURL(MODEL_PAGE) });

/** Chrome's own page about its on-device models: download state, versions, errors. */
export const openChromeModelStatus = () =>
  chrome.tabs.create({ url: 'chrome://on-device-internals' });

const POLL_MS = 2_000;

/** The model's availability, checked again every couple of seconds until it's settled. */
export function useModelAvailability() {
  const [availability, setAvailability] = useState<string>();

  useEffect(() => {
    let timer: number | undefined;
    const check = async () => {
      const next = await onDeviceModel()
        .availability()
        .catch((e: unknown) => `unavailable (${String(e)})`);
      setAvailability(next);
      if (next !== 'available' && !next.startsWith('unavailable')) {
        timer = window.setTimeout(() => void check(), POLL_MS);
      }
    };
    void check();
    return () => clearTimeout(timer);
  }, []);

  return [availability, setAvailability] as const;
}
