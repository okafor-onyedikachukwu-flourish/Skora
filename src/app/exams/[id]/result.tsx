import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { DateField } from '../../../components/DateField';
import { QuestionCrop } from '../../../components/QuestionCrop';
import { colors, radius, space } from '../../../components/theme';
import { Banner, Button, Card, Chip, EmptyState, ErrorView, Field, Input, LoadingView, Screen, SectionTitle, confirm } from '../../../components/ui';
import { getExam, getKey, type Exam, type KeyRow } from '../../../lib/db/exams';
import { AlreadySaved, recentSubjects, saveScript, suggestNames, type Chosen } from '../../../lib/db/scripts';
import { friendlyError } from '../../../lib/errors';
import { formatMarks, lettersFor, today } from '../../../lib/exams';
import { clearPending, getPending, getSaveDefaults, rememberSaveDefaults, setLastSaved, type PendingScript } from '../../../lib/scan/pending';
import { useLoad } from '../../../lib/useLoad';

type Entry = { chosen: Chosen; unsure: boolean; fixed: boolean };

/** Turns the reader's answer characters (see src/lib/scan/read.ts) into answers the teacher can check. */
function toEntries(answers: string, count: number): Entry[] {
  return Array.from({ length: count }, (_, i) => {
    const a = answers[i] ?? '-';
    if (a >= 'A' && a <= 'E') return { chosen: a as Chosen, unsure: false, fixed: false };
    if (a >= 'a' && a <= 'e') return { chosen: a.toUpperCase() as Chosen, unsure: true, fixed: false };
    if (a === '#') return { chosen: 'several', unsure: true, fixed: false };
    return { chosen: 'blank', unsure: false, fixed: false };
  });
}

const describe = (c: Chosen) => (c === 'blank' ? 'Blank' : c === 'several' ? 'Several' : c);

export default function ResultScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const db = useSQLiteContext();
  const [pending] = useState(() => getPending(id));
  const { data, loading, error, reload } = useLoad(async () => {
    const exam = await getExam(db, id);
    if (!exam) throw new Error('This exam was deleted.');
    return { exam, key: await getKey(db, id), subjects: await recentSubjects(db) };
  }, idParam);

  if (!pending) {
    return (
      <Screen>
        <EmptyState icon="scan-outline" title="Nothing to save" text="Scan a script first." action={<Button title="Back" onPress={() => router.back()} />} />
      </Screen>
    );
  }
  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  return <Result exam={data!.exam} keyRows={data!.key} subjects={data!.subjects} pending={pending} />;
}

function Result({ exam, keyRows, subjects, pending }: { exam: Exam; keyRows: KeyRow[]; subjects: string[]; pending: PendingScript }) {
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const defaults = getSaveDefaults(exam.id);
  const [entries, setEntries] = useState(() => toEntries(pending.answers, exam.questionCount));
  const [editing, setEditing] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState(defaults.subject);
  const [writtenOn, setWrittenOn] = useState<string | null>(defaults.writtenOn ?? today());
  const [classId, setClassId] = useState(
    exam.classes.some((c) => c.id === defaults.classId) ? defaults.classId! : (exam.classes[0]?.id ?? 0),
  );
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    suggestNames(db, classId, name)
      .then((s) => active && setSuggestions(s.filter((x) => x.toLowerCase() !== name.trim().toLowerCase())))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [db, classId, name]);

  const key = new Map(keyRows.map((k) => [k.q, k]));
  const letters = lettersFor(exam.optionCount);
  let score = 0;
  let right = 0;
  entries.forEach((e, i) => {
    const k = key.get(i + 1);
    if (k && e.chosen === k.option) {
      score += k.marks;
      right++;
    }
  });
  const maxScore = keyRows.reduce((s, k) => s + k.marks, 0);
  const unsure = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.unsure);
  const blanks = entries.filter((e) => e.chosen === 'blank').length;
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;

  function choose(i: number, chosen: Chosen) {
    setEntries((list) => list.map((e, j) => (j === i ? { chosen, unsure: false, fixed: e.fixed || chosen !== e.chosen } : e)));
    setEditing(null);
  }

  function acceptAll() {
    setEntries((list) => list.map((e) => (e.unsure ? { ...e, unsure: false } : e)));
  }

  async function save(replace = false) {
    setMessage(null);
    if (unsure.length > 0) return setMessage(`Check the ${unsure.length} highlighted ${unsure.length === 1 ? 'answer' : 'answers'} first.`);
    if (!writtenOn) return setMessage('Choose the date.');
    setBusy(true);
    try {
      const result = await saveScript(db, {
        examId: exam.id,
        classId,
        studentName: name,
        subject,
        writtenOn,
        sheetType: pending.sheetType,
        readBy: 'phone',
        teacherFixes: entries.filter((e) => e.fixed).length,
        answers: entries.map((e, i) => ({ q: i + 1, chosen: e.chosen, source: e.fixed ? 'teacher' : 'omr' })),
        replace,
      });
      rememberSaveDefaults(exam.id, { classId, subject: subject.trim(), writtenOn });
      setLastSaved({ examId: exam.id, name: name.trim(), score: result.score, maxScore: result.maxScore });
      clearPending();
      router.back();
    } catch (e) {
      setBusy(false);
      if (e instanceof AlreadySaved) {
        const className = exam.classes.find((c) => c.id === classId)?.name ?? 'this class';
        if (await confirm('Replace the saved score?', `${e.message.replace('this class', className)} Replace it with this script?`, 'Replace')) {
          await save(true);
        }
        return;
      }
      setMessage(friendlyError(e));
    }
  }

  async function discard() {
    if (!(await confirm('Discard this script?', 'Nothing is saved and the photo is deleted.', 'Discard'))) return;
    clearPending();
    router.back();
  }

  const cropWidth = Math.min(width - space.lg * 2 - space.md * 2 - 2, 420);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Result' }} />

      <Card>
        <Text style={styles.score}>
          {formatMarks(score)} <Text style={styles.outOf}>of {maxScore}</Text>
        </Text>
        <Text style={{ fontSize: 15, color: colors.text, marginTop: 2 }}>
          {maxScore > 0 ? `${percent}% · ${right} of ${keyRows.length} correct` : 'Set the answer key to see the score.'}
        </Text>
        <Text style={{ fontSize: 14, color: unsure.length ? colors.warning : colors.muted, marginTop: 4 }}>
          {[unsure.length ? `${unsure.length} to check` : 'Nothing to check', blanks ? `${blanks} left blank` : ''].filter(Boolean).join(' · ')}
        </Text>
      </Card>

      {unsure.length > 0 ? (
        <>
          <SectionTitle right={<Button small variant="ghost" title="Accept all" onPress={acceptAll} />}>Check these</SectionTitle>
          <Text style={{ fontSize: 13, color: colors.muted, marginBottom: space.sm }}>
            Faint, rubbed-out or double marks. Look at the photo and tap the student&apos;s answer, or Accept all to keep Skora&apos;s choice.
          </Text>
          {unsure.map(({ e, i }) => (
            <Card key={i} style={{ marginBottom: space.sm, borderColor: colors.warning, borderWidth: 1 }}>
              <Text style={{ fontWeight: '700', color: colors.text, marginBottom: space.sm }}>
                Question {i + 1} · Skora read {describe(e.chosen)}
              </Text>
              <QuestionCrop uri={pending.imageUri} index={i} optionCount={exam.optionCount} width={cropWidth} />
              <AnswerButtons letters={letters} value={e.chosen} onChoose={(c) => choose(i, c)} />
            </Card>
          ))}
        </>
      ) : null}

      <SectionTitle right={<Button small variant="ghost" title={showAll ? 'Hide' : 'Show'} onPress={() => setShowAll((s) => !s)} />}>
        All answers
      </SectionTitle>
      {showAll ? (
        <Card style={{ paddingVertical: space.xs }}>
          {entries.map((e, i) => {
            const k = key.get(i + 1);
            const ok = k ? e.chosen === k.option : null;
            return (
              <View key={i}>
                <Pressable onPress={() => setEditing(editing === i ? null : i)} style={[styles.answerRow, e.unsure && { backgroundColor: colors.warningSoft }]}>
                  <Text style={styles.qNo}>{i + 1}</Text>
                  <Text style={styles.chosen}>{describe(e.chosen)}</Text>
                  <Text style={styles.keyText}>{k ? `key ${k.option}` : 'no key'}</Text>
                  <Text style={[styles.mark, { color: ok ? colors.success : ok === false ? colors.danger : colors.faint }]}>
                    {ok ? '✓' : ok === false ? '✗' : '–'}
                  </Text>
                </Pressable>
                {editing === i ? <AnswerButtons letters={letters} value={e.chosen} onChoose={(c) => choose(i, c)} /> : null}
              </View>
            );
          })}
        </Card>
      ) : null}

      <SectionTitle>Save this script</SectionTitle>
      {message ? <Banner tone="danger" icon="alert-circle" title={message} /> : null}
      <Card>
        <Field label="Student's name">
          <Input value={name} onChangeText={setName} placeholder="As written on the script" autoCapitalize="words" maxLength={120} />
        </Field>
        {suggestions.length > 0 ? (
          <View style={styles.chips}>
            {suggestions.map((s) => (
              <Chip key={s} label={s} onPress={() => setName(s)} />
            ))}
          </View>
        ) : null}
        <Field label="Subject">
          <Input value={subject} onChangeText={setSubject} placeholder="e.g. Mathematics" autoCapitalize="words" maxLength={80} />
        </Field>
        {subjects.length > 0 ? (
          <View style={styles.chips}>
            {subjects
              .filter((s) => s.toLowerCase() !== subject.trim().toLowerCase())
              .slice(0, 5)
              .map((s) => (
                <Chip key={s} label={s} onPress={() => setSubject(s)} />
              ))}
          </View>
        ) : null}
        <Field label="Date">
          <DateField value={writtenOn} onChange={setWrittenOn} />
        </Field>
        {exam.classes.length > 1 ? (
          <Field label="Class">
            <View style={styles.chips}>
              {exam.classes.map((c) => (
                <Chip key={c.id} label={c.name} selected={classId === c.id} onPress={() => setClassId(c.id)} />
              ))}
            </View>
          </Field>
        ) : null}
        <Button
          title="Save"
          icon="checkmark"
          onPress={() => save()}
          loading={busy}
          disabled={name.trim().length < 2 || !subject.trim() || unsure.length > 0}
        />
        {unsure.length > 0 ? (
          <Text style={{ fontSize: 13, color: colors.warning, marginTop: space.sm, textAlign: 'center' }}>
            Check the highlighted answers above before saving.
          </Text>
        ) : null}
      </Card>

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        <Button variant="secondary" icon="camera-outline" title="Scan again" onPress={() => { clearPending(); router.back(); }} style={{ flex: 1 }} />
        <Button variant="danger" icon="trash-outline" title="Discard" onPress={discard} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}

function AnswerButtons({ letters, value, onChoose }: { letters: string[]; value: Chosen; onChoose: (c: Chosen) => void }) {
  const options: Chosen[] = [...(letters as Chosen[]), 'blank', 'several'];
  return (
    <View style={[styles.chips, { marginTop: space.sm }]}>
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onChoose(o)}
          accessibilityLabel={describe(o)}
          accessibilityState={{ selected: value === o }}
          style={[styles.answerButton, value === o && styles.answerButtonOn, o.length > 1 && { paddingHorizontal: space.md }]}
        >
          <Text style={[styles.answerButtonText, value === o && { color: '#fff' }]}>{describe(o)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  score: { fontSize: 30, fontWeight: '800', color: colors.text },
  outOf: { fontSize: 18, fontWeight: '600', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  answerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: space.xs, borderRadius: radius.sm, gap: space.md },
  qNo: { width: 32, textAlign: 'right', fontWeight: '700', color: colors.text },
  chosen: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  keyText: { fontSize: 13, color: colors.muted },
  mark: { width: 20, textAlign: 'center', fontSize: 16, fontWeight: '800' },
  answerButton: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerButtonOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  answerButtonText: { fontSize: 15, fontWeight: '700', color: colors.muted },
});
