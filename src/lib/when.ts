import { formatDate } from './sheet/render';

/** When something was saved, in the phone's time: "today, 10:42", "yesterday, 16:05" or "21 Nov 2026". */
export function whenSaved(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (day(d) === day(now)) return `today, ${time}`;
  if (day(d) === day(yesterday)) return `yesterday, ${time}`;
  return formatDate(day(d));
}
