/**
 * Turns dark mode on and off. `content/pageWorld.ts` runs first and keeps the
 * page dark and hidden until dark mode has darkened its stylesheets.
 */
import { watchDarkMode } from '../settings';
import { removeEarlyDark, startDarkMode, type DarkMode } from '../theme/darkMode';

// The last known answer (also read by content/pageWorld.ts), so dark mode
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
    // pageWorld.ts guessed dark from the last visit; show the page.
    removeEarlyDark();
  }
});
