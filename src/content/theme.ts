/** Runs at document_start, so the console turns dark before it first paints. */
import { startDarkMode, type DarkMode } from '../theme/darkMode';
import { watchDarkMode } from '../settings';

let darkMode: DarkMode | undefined;

void watchDarkMode((dark) => {
  if (dark && !darkMode) darkMode = startDarkMode();
  else if (!dark && darkMode) {
    darkMode.stop();
    darkMode = undefined;
  }
});
