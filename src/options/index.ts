import { localize, type MessageKey } from '../shared/i18n';
import { loadSettings, saveSettings, type Settings } from '../shared/settings';

const form = document.getElementById('form') as HTMLFormElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const detection = form.elements.namedItem('elementDetection') as RadioNodeList;
const showLabel = form.elements.namedItem('showElementLabel') as HTMLInputElement;
const arrowKeys = form.elements.namedItem('arrowKeys') as RadioNodeList;

function showSettings(settings: Settings) {
  detection.value = settings.elementDetection;
  showLabel.checked = settings.showElementLabel;
  arrowKeys.value = settings.arrowKeys;
}

function localizePage() {
  document.title = localize('optionsTitle');
  for (const labelled of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    labelled.textContent = localize(labelled.dataset.i18n as MessageKey);
  }
}

let statusTimer = 0;
async function persist() {
  const saved = await saveSettings({
    elementDetection: detection.value as Settings['elementDetection'],
    showElementLabel: showLabel.checked,
    arrowKeys: arrowKeys.value as Settings['arrowKeys'],
  });
  showSettings(saved);
  status.textContent = localize('optSaved');
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (status.textContent = ''), 1500);
}

async function showShortcut() {
  const commands = await chrome.commands.getAll();
  const main = commands.find((command) => command.name === '_execute_action');
  const shortcut = document.getElementById('shortcut') as HTMLParagraphElement;
  shortcut.textContent = main?.shortcut
    ? localize('optShortcutCurrent', main.shortcut)
    : localize('optShortcutNone');
}

localizePage();
showSettings(await loadSettings());
void showShortcut();

form.addEventListener('change', () => void persist());
document.getElementById('shortcuts')?.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
