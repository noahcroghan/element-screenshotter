import type messages from '../../static/_locales/en/messages.json';

export type MessageKey = keyof typeof messages;

/** Look up a localised string from _locales. Falls back to the key itself. */
export function localize(key: MessageKey, substitutions?: string | string[]): string {
  // chrome is missing outside the extension (e.g. unit tests).
  const api = (globalThis as { chrome?: typeof chrome }).chrome;
  return api?.i18n.getMessage(key, substitutions) || key;
}
