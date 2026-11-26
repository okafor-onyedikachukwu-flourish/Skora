import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';
import { grayImage, saveGrayJpegNative } from '../../../modules/skora-text';
import { rgbaToGray, type Gray } from './geometry';

/** Longest side, in pixels, that photos are reduced to before reading. Enough for every sheet layout. */
const MAX_SIDE = 1600;

function tempFile(ext: string) {
  return new File(Paths.cache, `skora-${randomUUID()}.${ext}`);
}

function drop(f: File) {
  try {
    if (f.exists) f.delete();
  } catch {
    // A leftover file in the cache is harmless.
  }
}

/**
 * Loads a photo as a greyscale image, upright and reduced in size so it reads quickly on any
 * phone. The phone's own image code does the decoding (about ten times faster than JavaScript);
 * the JavaScript decoder is only a fallback.
 */
export async function loadPhoto(uri: string): Promise<Gray> {
  const image = await ImageManipulator.manipulate(uri, { maxWidth: MAX_SIDE, maxHeight: MAX_SIDE }).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.92, base64: false });
  const photo = new File(saved.uri);
  const raw = tempFile('gray');
  try {
    const size = await grayImage(photo.uri, raw.uri).catch(() => null);
    if (size) {
      const data = await raw.bytes();
      if (data.length === size.width * size.height) return { data, width: size.width, height: size.height };
    }
    const decoded = jpeg.decode(await photo.bytes(), { useTArray: true, maxMemoryUsageInMB: 256 });
    return rgbaToGray(decoded.data, decoded.width, decoded.height);
  } finally {
    drop(photo);
    drop(raw);
  }
}

function scanFile(name: string) {
  const dir = new Directory(Paths.document, 'scans');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, name);
  if (file.exists) file.delete();
  return file;
}

/** Saves a greyscale image as a JPEG in the app's own storage and returns the file's URI. */
export async function saveGrayJpeg(g: Gray, name: string, quality = 70): Promise<string> {
  const file = scanFile(name);
  const raw = tempFile('gray');
  try {
    await raw.write(g.data);
    if (await saveGrayJpegNative(raw.uri, g.width, g.height, quality, file.uri).catch(() => false)) return file.uri;
  } catch {
    // Fall back to the JavaScript encoder below.
  } finally {
    drop(raw);
  }
  return saveGrayJpegJs(g, file, quality);
}

function saveGrayJpegJs(g: Gray, file: File, quality: number): string {
  const rgba = new Uint8Array(g.width * g.height * 4);
  for (let i = 0, j = 0; i < g.data.length; i++, j += 4) {
    rgba[j] = rgba[j + 1] = rgba[j + 2] = g.data[i];
    rgba[j + 3] = 255;
  }
  const bytes = encodeJpeg({ data: rgba, width: g.width, height: g.height }, quality);
  if (file.exists) file.delete();
  file.writeSync(bytes);
  return file.uri;
}

/**
 * jpeg-js returns `Buffer.from(bytes)` when bundled, and React Native has no `Buffer`.
 * A tiny stand-in is enough: the encoder only uses it to turn its byte list into an array.
 */
function encodeJpeg(image: { data: Uint8Array; width: number; height: number }, quality: number): Uint8Array {
  const g = globalThis as { Buffer?: unknown };
  const hadBuffer = g.Buffer !== undefined;
  if (!hadBuffer) g.Buffer = { from: (list: ArrayLike<number>) => Uint8Array.from(list) };
  try {
    return new Uint8Array(jpeg.encode(image, quality).data);
  } finally {
    if (!hadBuffer) delete g.Buffer;
  }
}

