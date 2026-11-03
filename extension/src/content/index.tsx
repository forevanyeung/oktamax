import { loadSettings, onSettingsChanged } from '../settings';
import { providers } from '../views';
import { answerOktaGets } from './oktaGet';
import { startScanner } from './scanner';
import { mountViewHost } from './viewHost';

async function main() {
  answerOktaGets();
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
