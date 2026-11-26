import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { colors, space } from '../../../components/theme';
import { Banner, Button, Card, ErrorView, Input, LoadingView } from '../../../components/ui';
import { getExam, getKey, saveKeyChanges } from '../../../lib/db/exams';
import { friendlyError } from '../../../lib/errors';
import { formatMarks, lettersFor, parseMarks, parseTypedKey } from '../../../lib/exams';
import { useLoad } from '../../../lib/useLoad';

const ROW_HEIGHT = 56;

type Key = { options: (string | null)[]; marks: number[] };

/** The mark most questions carry, used for new questions and the "each question" box. */
function usualMark(marks: number[]): number {
  const counts = new Map<number, number>();
  for (const m of marks) counts.set(m, (counts.get(m) ?? 0) + 1);
  let best = 1;
  let most = 0;
  for (const [m, c] of counts) if (c > most) [best, most] = [m, c];
  return best;
}

export default function AnswerKeyScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const db = useSQLiteContext();
  const { data, loading, error, reload } = useLoad(async () => {
    const exam = await getExam(db, id);
    if (!exam) throw new Error('This exam was deleted.');
    const rows = await getKey(db, id);
    const fallback = usualMark(rows.map((r) => r.marks));
    const key: Key = {
      options: Array.from({ length: exam.questionCount }, () => null),
      marks: Array.from({ length: exam.questionCount }, () => fallback),
    };
    for (const r of rows) {
      if (r.q <= exam.questionCount) {
        key.options[r.q - 1] = r.option;
        key.marks[r.q - 1] = r.marks;
      }
    }
    return { exam, key };
  }, idParam);

  if (loading) return <LoadingView />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  return <KeyEditor examId={id} optionCount={data!.exam.optionCount} initial={data!.key} />;
}

type SaveState = 'saved' | 'waiting' | 'saving' | 'error';

function KeyEditor({ examId, optionCount, initial }: { examId: number; optionCount: number; initial: Key }) {
  const db = useSQLiteContext();
  const [key, setKey] = useState<Key>(initial);
  const [savedKey, setSavedKey] = useState<Key>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [eachMark, setEachMark] = useState(String(usualMark(initial.marks)));
  const [showMarks, setShowMarks] = useState(new Set(initial.marks).size > 1);
  const savedRef = useRef(initial);
  const latestRef = useRef(initial);
  const mounted = useRef(true);
  const letters = lettersFor(optionCount);

  const save = useCallback(
    async (value: Key) => {
      const before = savedRef.current;
      const changes: { q: number; option: string | null; marks: number }[] = [];
      value.options.forEach((option, i) => {
        if (option !== before.options[i] || (option !== null && value.marks[i] !== before.marks[i])) {
          changes.push({ q: i + 1, option, marks: value.marks[i] });
        }
      });
      if (changes.length === 0) {
        savedRef.current = value;
        if (mounted.current) setSavedKey(value);
        return;
      }
      if (mounted.current) setSaving(true);
      try {
        await saveKeyChanges(db, examId, changes);
        savedRef.current = value;
        if (mounted.current) {
          setSavedKey(value);
          setSaveError(null);
        }
      } catch (e) {
        if (mounted.current) setSaveError(friendlyError(e));
      } finally {
        if (mounted.current) setSaving(false);
      }
    },
    [db, examId],
  );

  // Save shortly after the last change, and once more when leaving the screen.
  useEffect(() => {
    latestRef.current = key;
    if (key === savedRef.current) return;
    const t = setTimeout(() => save(key), 600);
    return () => clearTimeout(t);
  }, [key, save]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (latestRef.current !== savedRef.current) save(latestRef.current);
    };
  }, [save]);

  const choose = useCallback((index: number, letter: string) => {
    setKey((k) => {
      const options = [...k.options];
      options[index] = options[index] === letter ? null : letter;
      return { ...k, options };
    });
  }, []);

  const setMark = useCallback((index: number, marks: number) => {
    setKey((k) => {
      const all = [...k.marks];
      all[index] = marks;
      return { ...k, marks: all };
    });
  }, []);

  const each = parseMarks(eachMark);
  function applyEachMark() {
    if (each === null) return;
    setKey((k) => ({ ...k, marks: k.marks.map(() => each) }));
  }

  const parsed = parseTypedKey(typed, optionCount);
  function applyTyped() {
    if (parsed.length === 0) return;
    setKey((k) => ({ ...k, options: k.options.map((o, i) => (i < parsed.length ? parsed[i] : o)) }));
    setTyped('');
    setTyping(false);
  }

  const state: SaveState = saving ? 'saving' : saveError ? 'error' : key === savedKey ? 'saved' : 'waiting';
  const set = key.options.filter((o) => o !== null).length;
  const total = key.options.length;
  const totalMarks = key.options.reduce((sum, o, i) => (o === null ? sum : sum + key.marks[i]), 0);
  const items = Array.from({ length: total }, (_, i) => i);

  return (
    <>
      <Stack.Screen options={{ title: 'Answer key', headerRight: () => <SaveStatus state={state} /> }} />
      <FlatList
        data={items}
        keyExtractor={(i) => String(i)}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={20}
        windowSize={11}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 48 }}
        ListHeaderComponent={
          <View style={{ padding: space.lg, paddingBottom: space.sm, gap: space.md }}>
            {saveError ? (
              <Banner
                tone="danger"
                icon="alert-circle"
                title="Not saved yet"
                text={saveError}
                action={<Button small title="Try again" onPress={() => save(latestRef.current)} />}
              />
            ) : null}
            <View>
              <Text style={styles.progress}>
                {set} of {total} answers set · {formatMarks(totalMarks)}
              </Text>
              <Text style={styles.help}>Tap the correct option for each question. Tap it again to clear it. Changes save by themselves.</Text>
            </View>

            <Card>
              <Text style={styles.cardTitle}>Marks</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
                <Text style={{ fontSize: 15, color: colors.text }}>Each question</Text>
                <Input value={eachMark} onChangeText={setEachMark} keyboardType="decimal-pad" maxLength={5} style={{ width: 72 }} />
                <Button small variant="secondary" title="Apply to all" onPress={applyEachMark} disabled={each === null} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, gap: space.md }}>
                <Text style={{ flex: 1, fontSize: 14, color: colors.muted }}>Some questions carry different marks</Text>
                <Switch
                  value={showMarks}
                  onValueChange={setShowMarks}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Some questions carry different marks"
                />
              </View>
            </Card>

            {typing ? (
              <View style={{ gap: space.sm }}>
                <Input
                  value={typed}
                  onChangeText={setTyped}
                  placeholder={'e.g. ABDC CADB BBAC…\nor 1A 2C 3B…'}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  multiline
                  style={{ minHeight: 90, textAlignVertical: 'top' }}
                  autoFocus
                />
                <Text style={styles.help}>
                  {parsed.length > 0
                    ? `${Math.min(parsed.length, total)} answers read, filling questions 1–${Math.min(parsed.length, total)}.`
                    : 'Type or paste the answers in order. Numbers, spaces and commas are ignored.'}
                </Text>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button small title="Use these answers" onPress={applyTyped} disabled={parsed.length === 0} />
                  <Button small variant="ghost" title="Cancel" onPress={() => setTyping(false)} />
                </View>
              </View>
            ) : (
              <Button
                small
                variant="secondary"
                icon="create-outline"
                title="Type or paste the whole key"
                onPress={() => setTyping(true)}
                style={{ alignSelf: 'flex-start' }}
              />
            )}
          </View>
        }
        renderItem={({ item }) => (
          <KeyRow
            index={item}
            value={key.options[item]}
            marks={key.marks[item]}
            letters={letters}
            showMarks={showMarks}
            onChoose={choose}
            onMarks={setMark}
          />
        )}
      />
    </>
  );
}

const KeyRow = memo(function KeyRow({
  index,
  value,
  marks,
  letters,
  showMarks,
  onChoose,
  onMarks,
}: {
  index: number;
  value: string | null;
  marks: number;
  letters: string[];
  showMarks: boolean;
  onChoose: (index: number, letter: string) => void;
  onMarks: (index: number, marks: number) => void;
}) {
  return (
    <View style={[styles.row, index % 10 === 9 && styles.rowGap]}>
      <Text style={[styles.number, value === null && { color: colors.faint }]}>{index + 1}</Text>
      {letters.map((l) => (
        <Pressable
          key={l}
          onPress={() => onChoose(index, l)}
          accessibilityLabel={`Question ${index + 1}, option ${l}`}
          accessibilityState={{ selected: value === l }}
          style={[styles.bubble, value === l && styles.bubbleOn]}
        >
          <Text style={[styles.bubbleText, value === l && styles.bubbleTextOn]}>{l}</Text>
        </Pressable>
      ))}
      {showMarks ? <MarksBox key={marks} index={index} marks={marks} onMarks={onMarks} /> : null}
    </View>
  );
});

/** A small box for one question's marks. Wrong entries go back to the last good value. */
function MarksBox({ index, marks, onMarks }: { index: number; marks: number; onMarks: (index: number, marks: number) => void }) {
  const [text, setText] = useState(String(marks));
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onEndEditing={() => {
        const v = parseMarks(text);
        if (v === null) setText(String(marks));
        else if (v !== marks) onMarks(index, v);
      }}
      keyboardType="decimal-pad"
      maxLength={5}
      selectTextOnFocus
      accessibilityLabel={`Marks for question ${index + 1}`}
      style={styles.marks}
    />
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  const label = { saved: 'Saved', waiting: 'Saving…', saving: 'Saving…', error: 'Not saved' }[state];
  const color = state === 'error' ? colors.danger : state === 'saved' ? colors.success : colors.muted;
  return <Text style={{ color, fontSize: 14, fontWeight: '600' }}>{label}</Text>;
}

const styles = StyleSheet.create({
  progress: { fontSize: 18, fontWeight: '700', color: colors.text },
  help: { fontSize: 13, color: colors.muted, marginTop: 4 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  rowGap: { borderBottomWidth: 1, borderBottomColor: colors.border },
  number: { width: 36, fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'right', marginRight: space.xs },
  bubble: {
    flex: 1,
    maxWidth: 44,
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  bubbleText: { fontSize: 16, fontWeight: '700', color: colors.muted },
  bubbleTextOn: { color: '#fff' },
  marks: {
    width: 52,
    height: 40,
    marginLeft: space.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
});
