import { t, type MessageKey } from '../shared/i18n';
import { loadSettings, saveSettings, type Settings } from '../shared/settings';

const form = document.getElementById('form') as HTMLFormElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const qualityRow = document.getElementById('quality-row') as HTMLLabelElement;
const qualityValue = document.getElementById('quality-value') as HTMLOutputElement;

function localize() {
  document.title = t('optionsTitle');
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }
}

function field(name: string): HTMLInputElement {
  return form.elements.namedItem(name) as HTMLInputElement;
}

function radios(name: string): RadioNodeList {
  return form.elements.namedItem(name) as RadioNodeList;
}

function render(s: Settings) {
  radios('elementDetection').value = s.elementDetection;
  radios('format').value = s.format;
  field('jpegQuality').value = String(s.jpegQuality);
  field('saveAs').checked = s.saveAs;
  field('folder').value = s.folder;
  qualityRow.hidden = s.format !== 'jpeg';
  qualityValue.textContent = `${Math.round(s.jpegQuality * 100)}%`;
}

function read(): Partial<Settings> {
  return {
    elementDetection: radios('elementDetection').value as Settings['elementDetection'],
    format: radios('format').value as Settings['format'],
    jpegQuality: Number(field('jpegQuality').value),
    saveAs: field('saveAs').checked,
    folder: field('folder').value.trim(),
  };
}

let statusTimer = 0;
async function persist() {
  render(await saveSettings(read()));
  status.textContent = t('optSaved');
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (status.textContent = ''), 1500);
}

async function showShortcut() {
  const commands = await chrome.commands.getAll();
  const main = commands.find((c) => c.name === '_execute_action');
  const el = document.getElementById('shortcut') as HTMLParagraphElement;
  el.textContent = main?.shortcut ? t('optShortcutCurrent', main.shortcut) : t('optShortcutNone');
}

localize();
render(await loadSettings());
void showShortcut();

form.addEventListener('change', () => void persist());
field('jpegQuality').addEventListener('input', () => {
  qualityValue.textContent = `${Math.round(Number(field('jpegQuality').value) * 100)}%`;
});
document.getElementById('shortcuts')?.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
