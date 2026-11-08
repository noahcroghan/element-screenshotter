export type ElementDetection = 'smart' | 'exact';

export interface Settings {
  /**
   * "smart" follows Firefox: start from the element under the cursor but skip
   * headings, prefer article containers, and ignore huge wrappers.
   * "exact" always starts from the element directly under the cursor.
   */
  elementDetection: ElementDetection;
  /**
   * Show a label with the highlighted element's tag, id, classes, and size.
   * Off by default, like Firefox.
   */
  showElementLabel: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  elementDetection: 'smart',
  showElementLabel: false,
});

/** Coerce whatever is in storage into a valid Settings object. */
export function normalizeSettings(raw: unknown): Settings {
  const stored = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const detection = stored.elementDetection;
  return {
    elementDetection:
      detection === 'smart' || detection === 'exact'
        ? detection
        : DEFAULT_SETTINGS.elementDetection,
    showElementLabel:
      typeof stored.showElementLabel === 'boolean'
        ? stored.showElementLabel
        : DEFAULT_SETTINGS.showElementLabel,
  };
}

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS)));
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  await chrome.storage.sync.set(next);
  return next;
}
