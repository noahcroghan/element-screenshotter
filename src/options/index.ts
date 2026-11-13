import { localize, type MessageKey } from '../shared/i18n';
import { loadSettings, resetSettings, saveSettings, type Settings } from '../shared/settings';

const form = document.getElementById('form') as HTMLFormElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const detection = form.elements.namedItem('elementDetection') as RadioNodeList;
const showLabel = form.elements.namedItem('showElementLabel') as HTMLInputElement;
const arrowKeys = form.elements.namedItem('arrowKeys') as RadioNodeList;
const movablePanel = form.elements.namedItem('movablePanel') as HTMLInputElement;
const ownCursor = form.elements.namedItem('ownCursor') as HTMLInputElement;
const zenBrowserStyle = form.elements.namedItem('zenBrowserStyle') as HTMLInputElement;
const resetDialog = document.getElementById('reset-dialog') as HTMLDialogElement;

function showSettings(settings: Settings) {
  detection.value = settings.elementDetection;
  showLabel.checked = settings.showElementLabel;
  arrowKeys.value = settings.arrowKeys;
  movablePanel.checked = settings.movablePanel;
  ownCursor.checked = settings.ownCursor;
  zenBrowserStyle.checked = settings.zenBrowserStyle;
}

/** Fill an element with a message, turning `<kbd>Key</kbd>` into real kbd elements. */
function fillMessage(element: HTMLElement, message: string) {
  element.replaceChildren(
    ...message
      .split(/<kbd>(.*?)<\/kbd>/)
      .map((part, index) =>
        index % 2 ? Object.assign(document.createElement('kbd'), { textContent: part }) : part,
      ),
  );
}

function localizePage() {
  document.title = localize('optionsTitle');
  for (const labelled of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    labelled.textContent = localize(labelled.dataset.i18n as MessageKey);
  }
}

let statusTimer = 0;
function showStatus(message: string) {
  status.textContent = message;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (status.textContent = ''), 1500);
}

async function persist() {
  const saved = await saveSettings({
    elementDetection: detection.value as Settings['elementDetection'],
    showElementLabel: showLabel.checked,
    arrowKeys: arrowKeys.value as Settings['arrowKeys'],
    movablePanel: movablePanel.checked,
    ownCursor: ownCursor.checked,
    zenBrowserStyle: zenBrowserStyle.checked,
  });
  showSettings(saved);
  showStatus(localize('optSaved'));
}

async function reset() {
  showSettings(await resetSettings());
  showStatus(localize('optResetDone'));
}

async function showShortcut() {
  const commands = await chrome.commands.getAll();
  const main = commands.find((command) => command.name === '_execute_action');
  const shortcut = document.getElementById('shortcut') as HTMLParagraphElement;
  // "Ctrl+Shift+S" shows as one key cap per key. macOS reports symbols
  // without separators ("\u21E7\u2318S"), which stay one key cap.
  const keys = main?.shortcut
    ?.split('+')
    .map((key) => `<kbd>${key}</kbd>`)
    .join('+');
  fillMessage(shortcut, keys ? localize('optShortcutCurrent', keys) : localize('optShortcutNone'));
}

localizePage();
showSettings(await loadSettings());
void showShortcut();

form.addEventListener('change', () => void persist());
document.getElementById('reset')?.addEventListener('click', () => {
  // Escape closes the dialog without touching returnValue, so clear it first.
  resetDialog.returnValue = '';
  resetDialog.showModal();
});
resetDialog.addEventListener('close', () => {
  if (resetDialog.returnValue === 'reset') void reset();
});
document.getElementById('shortcuts')?.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
