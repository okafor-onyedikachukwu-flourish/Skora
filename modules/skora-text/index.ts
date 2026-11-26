import { requireOptionalNativeModule } from 'expo';

/** A box in pixels: left, top, right, bottom. Empty when ML Kit gave none. */
export type TextBox = number[];
export type TextWord = { text: string; box: TextBox; confidence: number };
export type TextLine = { text: string; block: number; box: TextBox; confidence: number; angle: number; words: TextWord[] };
export type TextPage = { width: number; height: number; lines: TextLine[] };

type SkoraTextModule = { readTextAsync(uri: string): Promise<TextPage> };

// Android only. Missing in Expo Go and on the web, where Skora leaves handwriting to Gemini.
const native = requireOptionalNativeModule<SkoraTextModule>('SkoraText');

/** True when this phone can read writing itself, without internet. */
export const canReadText = native != null;

/** Reads the writing on a photo (a file:// URI). Returns null when the phone cannot read text. */
export async function readText(uri: string): Promise<TextPage | null> {
  return native ? native.readTextAsync(uri) : null;
}
