import { requireOptionalNativeModule } from 'expo';

/** A box in pixels: left, top, right, bottom. Empty when ML Kit gave none. */
export type TextBox = number[];
export type TextSymbol = { text: string; box: TextBox; confidence: number };
export type TextWord = { text: string; box: TextBox; confidence: number; symbols?: TextSymbol[] };
export type TextLine = { text: string; block: number; box: TextBox; confidence: number; angle: number; words: TextWord[] };
export type TextPage = { width: number; height: number; lines: TextLine[] };

type SkoraTextModule = {
  readTextAsync(uri: string): Promise<TextPage>;
  grayImageAsync(uri: string, outUri: string): Promise<{ width: number; height: number }>;
  saveGrayJpegAsync(rawUri: string, width: number, height: number, quality: number, outUri: string): Promise<string>;
  hasReaderAsync(): Promise<boolean>;
  classifyAsync(inputUri: string, count: number): Promise<{ classes: number; probs: number[] }>;
};

// Android only. Missing in Expo Go and on the web, where Skora leaves handwriting to Gemini.
const native = requireOptionalNativeModule<SkoraTextModule>('SkoraText');

/** True when this phone can read writing itself, without internet. */
export const canReadText = native != null;

/** Reads the writing on a photo (a file:// URI). Returns null when the phone cannot read text. */
export async function readText(uri: string): Promise<TextPage | null> {
  return native ? native.readTextAsync(uri) : null;
}

/** True when this phone can convert photos natively (much faster than in JavaScript). */
export const canConvertImages = native != null && typeof native.grayImageAsync === 'function';

/**
 * Writes one grey byte per pixel of a JPEG or PNG (already upright) to outUri. Null when the
 * phone cannot do it natively.
 */
export async function grayImage(uri: string, outUri: string): Promise<{ width: number; height: number } | null> {
  return canConvertImages ? native!.grayImageAsync(uri, outUri) : null;
}

/** Saves the grey bytes in rawUri as a JPEG at outUri. False when the phone cannot do it natively. */
export async function saveGrayJpegNative(rawUri: string, width: number, height: number, quality: number, outUri: string): Promise<boolean> {
  if (!canConvertImages) return false;
  await native!.saveGrayJpegAsync(rawUri, width, height, quality, outUri);
  return true;
}

let readerChecked: Promise<boolean> | null = null;

/** True when this app has Skora's own reader model (trained by tools/model/train.py). */
export function hasReader(): Promise<boolean> {
  if (!native || typeof native.hasReaderAsync !== 'function') return Promise.resolve(false);
  readerChecked ??= native.hasReaderAsync().catch(() => false);
  return readerChecked;
}

/** Runs the reader model on `count` prepared inputs (32 × 32 float32 each) saved in a file. */
export async function classifyFile(inputUri: string, count: number): Promise<{ classes: number; probs: number[] } | null> {
  if (!(await hasReader())) return null;
  return native!.classifyAsync(inputUri, count);
}
