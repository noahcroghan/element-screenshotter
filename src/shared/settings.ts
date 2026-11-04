import type { ImageFormat } from './filename';

export type ElementDetection = 'smart' | 'exact';

export interface Settings {
  /**
   * "smart" follows Firefox: start from the element under the cursor but skip
   * headings, prefer article containers, and ignore huge wrappers.
   * "exact" always starts from the element directly under the cursor.
   */
  elementDetection: ElementDetection;
  format: ImageFormat;
  /** JPEG quality, 0.5 - 1. */
  jpegQuality: number;
  /** Show the browser's "Save as" dialog for every download. */
  saveAs: boolean;
  /** Optional sub-folder of the Downloads folder, e.g. "Screenshots". */
  folder: string;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  elementDetection: 'smart',
  format: 'png',
  jpegQuality: 0.92,
  saveAs: false,
  folder: '',
});

/** Coerce whatever is in storage into a valid Settings object. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (r.elementDetection === 'smart' || r.elementDetection === 'exact') {
    s.elementDetection = r.elementDetection;
  }
  if (r.format === 'png' || r.format === 'jpeg') s.format = r.format;
  if (typeof r.jpegQuality === 'number' && Number.isFinite(r.jpegQuality)) {
    s.jpegQuality = Math.min(1, Math.max(0.5, r.jpegQuality));
  }
  if (typeof r.saveAs === 'boolean') s.saveAs = r.saveAs;
  if (typeof r.folder === 'string') s.folder = r.folder.slice(0, 100);
  return s;
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return normalizeSettings(raw);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  await chrome.storage.sync.set(next);
  return next;
}
