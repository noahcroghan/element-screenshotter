import type messages from '../../static/_locales/en/messages.json';

export type MessageKey = keyof typeof messages;

/** Text direction of the extension's UI language (not the page's). */
export function uiDirection(): 'ltr' | 'rtl' {
  const api = (globalThis as { chrome?: typeof chrome }).chrome;
  return api?.i18n.getMessage('@@bidi_dir') === 'rtl' ? 'rtl' : 'ltr';
}

/** Look up a localised string from _locales. Falls back to the key itself. */
export function t(key: MessageKey, substitutions?: string | string[]): string {
  // chrome is missing outside the extension (e.g. unit tests).
  const api = (globalThis as { chrome?: typeof chrome }).chrome;
  const value = api?.i18n.getMessage(key, substitutions);
  return value || key;
}
