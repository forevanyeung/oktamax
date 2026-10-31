/**
 * Turns dark mode on and off. Like `pageWorld.iife.ts`, injected as-is (not
 * through CRXJS's async loader), so dark mode starts at document_start.
 */
import { watchDarkMode } from '../settings';
import { removeEarlyDark, startDarkMode, type DarkMode } from '../theme/darkMode';

// The last known answer (also read by pageWorld.iife.ts), so dark mode
// starts without waiting for `chrome.storage`.
const LAST_DARK = 'oktamax-dark';

let darkMode: DarkMode | undefined =
  localStorage.getItem(LAST_DARK) === '1' ? startDarkMode() : undefined;

void watchDarkMode((dark) => {
  localStorage.setItem(LAST_DARK, dark ? '1' : '0');
  if (dark && !darkMode) darkMode = startDarkMode();
  else if (!dark) {
    darkMode?.stop();
    darkMode = undefined;
    // pageWorld.iife.ts guessed dark from the last visit; show the page.
    removeEarlyDark();
  }
});
