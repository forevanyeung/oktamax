/**
 * Downloads Chrome's built-in model for the on-device assistant. It's a tab
 * rather than part of the popup, which closes as soon as it loses focus,
 * taking the download it started with it. Chrome only starts the download from a
 * click, so the page has its own button.
 */
import { useState } from 'react';

import { onDeviceModel } from '../onDeviceModel';
import { renderRoot } from '../renderRoot';
import { watchDarkMode } from '../settings';
import { openChromeModelStatus, useModelAvailability } from './availability';

void watchDarkMode((dark) => (document.documentElement.dataset.theme = dark ? 'dark' : 'light'));

const ModelPage = () => {
  const [availability, setAvailability] = useModelAvailability();
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();

  const download = async () => {
    setError(undefined);
    setProgress(0);
    try {
      await onDeviceModel().createSessionWithProgress(setProgress);
      setAvailability('available');
    } catch (e) {
      setError(String(e));
      setProgress(undefined);
    }
  };

  const ready = availability === 'available';
  const unavailable = availability?.startsWith('unavailable');
  return (
    <main>
      <header>
        <img src="/icons/icon-32.png" width={32} height={32} alt="" />
        <h1>Chrome’s built-in model</h1>
      </header>
      <p>
        The on-device assistant answers with Gemini Nano, the model built into Chrome. Chrome
        downloads it once (a few GB) for the whole browser: every site and extension that uses it
        shares the same copy.
      </p>
      {availability === undefined ? null : ready ? (
        <p>
          <strong>The model is ready.</strong> You can close this tab and ask the assistant on any
          admin console.
        </p>
      ) : unavailable ? (
        <p className="error">
          Chrome’s built-in model can’t run on this device ({availability}). It needs Chrome on
          Windows, macOS or Linux, a GPU with more than 4 GB of memory (or 16 GB of RAM), and 22 GB
          of free disk space.
        </p>
      ) : (
        <>
          <p>
            {progress === undefined
              ? availability === 'downloading'
                ? 'Chrome is downloading the model. Click Download to follow its progress here.'
                : 'Click Download to start.'
              : `Downloading: ${Math.round(progress * 100)}%. Keep this tab open until it finishes; you can use other tabs meanwhile.`}
          </p>
          {progress !== undefined && (
            <p>
              <progress value={progress} />
            </p>
          )}
          <p>
            <button type="button" onClick={() => void download()} disabled={progress !== undefined}>
              Download
            </button>
          </p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <p className="muted">
        Chrome’s own status page shows the download and any errors:{' '}
        <button type="button" className="link" onClick={() => void openChromeModelStatus()}>
          chrome://on-device-internals
        </button>
      </p>
    </main>
  );
};

renderRoot(<ModelPage />);
