import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { classifyFile, grayImage, hasReader } from '../../../modules/skora-text';
import { READER_CLASSES } from './classes';
import { normalizeInto, SIZE, type GrayImage } from './normalize';

export { READER_CLASSES };

/** Each box is widened by this share of its size on every side before it is cut out. */
const WIDEN = 0.15;

function drop(f: File) {
  try {
    if (f.exists) f.delete();
  } catch {
    // A leftover file in the cache is harmless.
  }
}

/** A page photo (JPEG) as greyscale pixels, for cutting characters out of it. */
export async function loadGray(uri: string): Promise<GrayImage | null> {
  const raw = new File(Paths.cache, `skora-${randomUUID()}.gray`);
  try {
    const size = await grayImage(uri, raw.uri);
    if (!size) return null;
    const data = await raw.bytes();
    return data.length === size.width * size.height ? { data, width: size.width, height: size.height } : null;
  } catch {
    return null;
  } finally {
    drop(raw);
  }
}

export { hasReader };

/**
 * Reads each box (left, top, right, bottom in page pixels) with Skora's own model. Returns the
 * probabilities for READER_CLASSES, one list per box, or null when the model is not in the app.
 */
export async function classifyBoxes(page: GrayImage, boxes: number[][]): Promise<number[][] | null> {
  if (boxes.length === 0) return [];
  if (!(await hasReader())) return null;
  const input = new Float32Array(boxes.length * SIZE * SIZE);
  boxes.forEach((b, i) => {
    const padX = Math.max(2, (b[2] - b[0]) * WIDEN);
    const padY = Math.max(2, (b[3] - b[1]) * WIDEN);
    normalizeInto(page, [b[0] - padX, b[1] - padY, b[2] + padX, b[3] + padY], input, i * SIZE * SIZE);
  });
  // The model takes 0 (paper) to 255 (ink), like its training examples.
  for (let i = 0; i < input.length; i++) input[i] *= 255;
  const file = new File(Paths.cache, `skora-${randomUUID()}.f32`);
  try {
    await file.write(new Uint8Array(input.buffer));
    const out = await classifyFile(file.uri, boxes.length);
    if (!out || out.classes !== READER_CLASSES.length || out.probs.length !== boxes.length * out.classes) return null;
    return boxes.map((_, i) => out.probs.slice(i * out.classes, (i + 1) * out.classes));
  } catch {
    return null;
  } finally {
    drop(file);
  }
}
