import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as XLSX from 'xlsx';
import { exportData, formatScore, passes } from './db/scores';
import type { Chosen } from './db/scripts';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function cell(c: Chosen | undefined): string {
  if (!c || c === 'blank') return '';
  return c === 'several' ? '*' : c;
}

/**
 * Makes a spreadsheet of an exam's scores and opens the share sheet (WhatsApp, email, Drive...).
 * Sheet "Scores": one row per student, highest first. Sheet "Answers": each student's answers,
 * under the key (blank = no answer, * = more than one).
 */
export async function shareScores(
  db: SQLiteDatabase,
  exam: { id: number; title: string; questionCount: number },
  classId: number | null,
  className: string | null,
  passMark: number,
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("This phone can't share files.");
  const { key, scripts } = await exportData(db, exam.id, classId);
  if (scripts.length === 0) throw new Error('No scores are saved yet.');

  const scores: (string | number)[][] = [['Position', 'Name', 'Class', 'Score', 'Out of', 'Percent', `Passed (${passMark}% or more)`, 'Subject', 'Date']];
  let position = 0;
  scripts.forEach((s, i) => {
    if (i === 0 || s.score !== scripts[i - 1].score) position = i + 1;
    scores.push([
      position,
      s.studentName,
      s.className,
      Number(formatScore(s.score)),
      Number(formatScore(s.maxScore)),
      s.percent === null ? '' : Math.round(s.percent * 10) / 10,
      passes(s.percent, passMark) ? 'Yes' : 'No',
      s.subject,
      s.writtenOn,
    ]);
  });

  const qs = Array.from({ length: exam.questionCount }, (_, i) => i + 1);
  const keyByQ = new Map(key.map((k) => [k.q, k.option]));
  const answers: (string | number)[][] = [
    ['Name', 'Class', 'Score', ...qs.map((q) => `Q${q}`)],
    ['ANSWER KEY', '', '', ...qs.map((q) => keyByQ.get(q) ?? '')],
    ...scripts.map((s) => [s.studentName, s.className, Number(formatScore(s.score)), ...qs.map((q) => cell(s.answers.get(q)))]),
  ];

  const book = XLSX.utils.book_new();
  const scoresSheet = XLSX.utils.aoa_to_sheet(scores);
  scoresSheet['!cols'] = [{ wch: 9 }, { wch: 28 }, { wch: 10 }, { wch: 7 }, { wch: 7 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 11 }];
  XLSX.utils.book_append_sheet(book, scoresSheet, 'Scores');
  const answersSheet = XLSX.utils.aoa_to_sheet(answers);
  answersSheet['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 7 }, ...qs.map(() => ({ wch: 4 }))];
  XLSX.utils.book_append_sheet(book, answersSheet, 'Answers');
  // Base64 is the form SheetJS documents for React Native.
  const base64 = XLSX.write(book, { type: 'base64', bookType: 'xlsx' }) as string;

  const name = `${exam.title}${className ? ` - ${className}` : ''} - scores.xlsx`.replace(/[\\/:*?"<>|]+/g, ' ');
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  await file.write(base64, { encoding: 'base64' });
  await Sharing.shareAsync(file.uri, { mimeType: XLSX_TYPE, dialogTitle: 'Share the scores', UTI: 'org.openxmlformats.spreadsheetml.sheet' });
}
