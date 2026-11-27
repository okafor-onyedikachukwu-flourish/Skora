/** What Skora's reader model tells apart, in its output order (tools/model/train.py CLASSES). */
export const READER_CLASSES = [...'0123456789ABCDE', 'other', 'crossed'] as const;
export const OTHER = READER_CLASSES.indexOf('other');
export const CROSSED = READER_CLASSES.indexOf('crossed');
export const classIndex = (c: string) => READER_CLASSES.indexOf(c as (typeof READER_CLASSES)[number]);
