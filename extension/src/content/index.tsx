import { loadSettings, onSettingsChanged } from '../settings';
import { providers } from '../views';
import { startScanner } from './scanner';
import { mountViewHost } from './viewHost';

async function main() {
  const settings = await loadSettings();
  const { openView } = mountViewHost();

  const scanner = startScanner({
    providers,
    openView,
    alwaysShow: () => settings.alwaysShowViewButton,
  });

  onSettingsChanged((next) => {
    Object.assign(settings, next);
    scanner.rescan();
  });
}

void main();
