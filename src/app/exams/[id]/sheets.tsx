import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Text } from 'react-native';
import { colors, space } from '../../../components/theme';
import { Banner, Button, Card, ErrorView, Field, Input, LoadingView, Screen } from '../../../components/ui';
import { getExam } from '../../../lib/db/exams';
import { friendlyError } from '../../../lib/errors';
import { optionsLabel } from '../../../lib/exams';
import { useSettings } from '../../../lib/settings';
import { sheetsHtml, type SheetExam } from '../../../lib/sheet/render';
import { useLoad } from '../../../lib/useLoad';

// A4 in points (72 per inch).
const A4 = { width: 595, height: 842 };

export default function AnswerSheets() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const { data: exam, loading, error, reload } = useLoad(async () => {
    const e = await getExam(db, id);
    if (!e) throw new Error('This exam was deleted.');
    return e;
  }, idParam);
  const [copies, setCopies] = useState('1');
  const [busy, setBusy] = useState<'print' | 'share' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (loading || !settings) return <LoadingView />;
  if (error && !exam) return <ErrorView message={error} onRetry={reload} />;
  const e = exam!;
  const copyCount = Math.min(200, Math.max(1, Number(copies) || 1));
  const sheet: SheetExam = {
    title: e.title,
    questionCount: e.questionCount,
    optionCount: e.optionCount,
    totalMarks: e.keySet === e.questionCount ? e.totalMarks : 0,
    classNames: e.classes.map((c) => c.name).join(', '),
    schoolName: settings.schoolName,
    teacherName: settings.teacherName,
  };

  async function print() {
    setBusy('print');
    setMessage(null);
    try {
      await Print.printAsync({ html: sheetsHtml(sheet, copyCount), ...A4 });
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    setBusy('share');
    setMessage(null);
    try {
      const { uri } = await Print.printToFileAsync({ html: sheetsHtml(sheet, copyCount), ...A4 });
      const name = `${e.title} - Skora answer sheets.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');
      const target = new File(Paths.cache, name);
      if (target.exists) target.delete();
      await new File(uri).move(target);
      if (!(await Sharing.isAvailableAsync())) throw new Error("This phone can't share files.");
      await Sharing.shareAsync(target.uri, { mimeType: 'application/pdf', dialogTitle: 'Share answer sheets', UTI: 'com.adobe.pdf' });
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Answer sheets' }} />
      {message ? <Banner tone="danger" icon="alert-circle" title={message} /> : null}

      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{e.title}</Text>
        <Text style={{ fontSize: 14, color: colors.muted }}>
          {e.questionCount} questions · options {optionsLabel(e.optionCount)} · one A4 page
        </Text>
      </Card>

      <Text style={{ fontSize: 14, lineHeight: 20, color: colors.text, marginVertical: space.lg }}>
        Students shade one bubble for each answer and write their name, class, subject and date in the boxes. There is no code
        on the sheet: you pick this exam before scanning. Sheets are optional, and students can also write their answers on any
        paper.
      </Text>

      <Field label="Copies" hint="Or print one and photocopy it. Every copy is the same.">
        <Input value={copies} onChangeText={(t) => setCopies(t.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" style={{ width: 100 }} />
      </Field>

      {!settings.schoolName && !settings.teacherName ? (
        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: space.md }}>
          Add your name and school in Settings to print them at the top of the sheet.
        </Text>
      ) : null}

      <Button title="Print" icon="print-outline" onPress={print} loading={busy === 'print'} disabled={busy !== null} />
      <Button
        variant="secondary"
        icon="share-social-outline"
        title="Share PDF (e.g. to a print shop)"
        onPress={share}
        loading={busy === 'share'}
        disabled={busy !== null}
        style={{ marginTop: space.sm }}
      />
    </Screen>
  );
}
