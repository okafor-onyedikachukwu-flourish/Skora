import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PassBadge, ScoreRing } from '../../components/scores';
import { colors, radius, space } from '../../components/theme';
import { Banner, Button, Card, ErrorView, Input, LoadingView, Screen, SectionTitle, confirm } from '../../components/ui';
import { lettersFor } from '../../lib/exams';
import { changeAnswer, deleteScript, formatScore, getScript, passes, renameScript, type SavedAnswer } from '../../lib/db/scores';
import type { Chosen } from '../../lib/db/scripts';
import { friendlyError } from '../../lib/errors';
import { describeAnswer } from '../../lib/scan/answers';
import { formatDate } from '../../lib/sheet/render';
import { useSettings } from '../../lib/settings';
import { useLoad } from '../../lib/useLoad';

const READ_BY = { phone: 'The phone', gemini: 'Gemini', both: 'The phone and Gemini' } as const;

/** One saved script: the score, every answer against the key, and changing, renaming or deleting it. */
export default function ScriptScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const db = useSQLiteContext();
  const { settings } = useSettings();
  const passMark = settings?.passMarkPercent ?? 50;
  const [editing, setEditing] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { data: s, loading, error, reload } = useLoad(async () => {
    const script = await getScript(db, id);
    if (!script) throw new Error('This score was deleted.');
    return script;
  }, idParam);

  if (loading) return <LoadingView />;
  if (error && !s) return <ErrorView message={error} onRetry={reload} />;
  const script = s!;
  const letters = lettersFor(script.optionCount) as Chosen[];
  const byQ = new Map(script.answers.map((a) => [a.q, a]));
  const questions = Array.from({ length: script.questionCount }, (_, i) => i + 1);
  const right = script.answers.filter((a) => a.isCorrect).length;
  const blank = script.answers.filter((a) => a.chosen === 'blank').length;
  const checked = script.answers.filter((a) => a.source === 'teacher').length;
  const editingAnswer = editing === null ? null : byQ.get(editing);

  async function choose(q: number, chosen: Chosen) {
    if (byQ.get(q)?.chosen === chosen) return setEditing(null);
    setMessage(null);
    try {
      await changeAnswer(db, script.id, q, chosen);
      setEditing(null);
      await reload();
    } catch (e) {
      setMessage(friendlyError(e));
    }
  }

  async function saveName() {
    if (renaming === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await renameScript(db, script.id, renaming);
      setRenaming(null);
      await reload();
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm(`Delete ${script.studentName}'s score?`, `The score for "${script.examTitle}" is deleted. This can't be undone.`))) return;
    try {
      await deleteScript(db, script.id);
      router.back();
    } catch (e) {
      setMessage(friendlyError(e));
    }
  }

  const pass = passes(script.percent, passMark);
  return (
    <Screen>
      <Stack.Screen options={{ title: script.studentName }} />
      {message ? <Banner tone="danger" icon="alert-circle" title={message} /> : null}

      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <ScoreRing percent={script.percent} size={84} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.big}>
              {formatScore(script.score)} <Text style={styles.outOf}>{`of ${formatScore(script.maxScore)}`}</Text>
            </Text>
            <PassBadge pass={pass} />
            <Text style={styles.muted}>{`${ordinal(script.position)} of ${script.outOf} in this exam`}</Text>
          </View>
        </View>
        <View style={styles.facts}>
          <Fact label="Exam" value={script.examTitle} />
          <Fact label="Class" value={script.className} />
          <Fact label="Subject" value={script.subject} />
          <Fact label="Written on" value={formatDate(script.writtenOn)} />
          <Fact label="Answers" value={`${right} right · ${script.questionCount - right - blank} wrong · ${blank} blank`} />
          <Fact label="Read by" value={`${READ_BY[script.readBy]}${checked ? ` · you set ${checked}` : ''}`} />
        </View>
      </Card>

      <SectionTitle
        right={
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Legend bg={colors.successSoft} line={colors.success} label="Right" />
            <Legend bg={colors.warningSoft} line={colors.warning} label="Wrong (key)" />
          </View>
        }
      >
        Answers
      </SectionTitle>
      <Card style={styles.grid}>
        {questions.map((q) => (
          <AnswerCell key={q} q={q} a={byQ.get(q)} selected={editing === q} onPress={() => setEditing(editing === q ? null : q)} />
        ))}
      </Card>

      {editing !== null ? (
        <Card style={{ marginTop: space.md, gap: space.sm }}>
          <Text style={styles.strong}>{`Question ${editing}${editingAnswer?.key ? ` · the key is ${editingAnswer.key}` : ' · no key set'}`}</Text>
          <Text style={styles.muted}>{"Tap the student's answer. The score updates straight away."}</Text>
          <View style={styles.answers}>
            {[...letters, 'blank' as const, 'several' as const].map((o) => {
              const on = editingAnswer?.chosen === o;
              return (
                <Pressable
                  key={o}
                  onPress={() => choose(editing, o)}
                  accessibilityRole="button"
                  accessibilityLabel={describeAnswer(o)}
                  accessibilityState={{ selected: on }}
                  style={[styles.answerButton, on && styles.answerOn, o.length > 1 && { paddingHorizontal: space.md }]}
                >
                  <Text style={[styles.answerText, on && { color: '#FFFFFF' }]}>{describeAnswer(o)}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : (
        <Text style={[styles.muted, { marginTop: space.sm }]}>Tap an answer to change it.</Text>
      )}

      <SectionTitle>Name</SectionTitle>
      {renaming !== null ? (
        <Card style={{ gap: space.sm }}>
          <Input value={renaming} onChangeText={setRenaming} autoCapitalize="words" maxLength={120} autoFocus />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button small title="Save" onPress={saveName} loading={busy} disabled={renaming.trim().length < 2} />
            <Button small variant="ghost" title="Cancel" onPress={() => setRenaming(null)} />
          </View>
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: renaming !== null ? space.md : 0 }}>
        {renaming === null ? (
          <Button variant="secondary" icon="create-outline" title="Rename" onPress={() => setRenaming(script.studentName)} style={{ flex: 1 }} />
        ) : null}
        <Button variant="danger" icon="trash-outline" title="Delete score" onPress={remove} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '50%', paddingRight: space.sm, marginBottom: space.sm }}>
      <Text style={styles.small}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function Legend({ bg, line, label }: { bg: string; line: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: bg, borderWidth: 1, borderColor: line }} />
      <Text style={styles.small}>{label}</Text>
    </View>
  );
}

function AnswerCell({ q, a, selected, onPress }: { q: number; a: SavedAnswer | undefined; selected: boolean; onPress: () => void }) {
  const right = !!a?.isCorrect;
  const noKey = !a?.key;
  const shown = !a ? '?' : a.chosen === 'blank' ? '–' : a.chosen === 'several' ? '2+' : a.chosen;
  const tone = noKey
    ? { backgroundColor: colors.bg, borderColor: colors.border, fg: colors.muted }
    : right
      ? { backgroundColor: colors.successSoft, borderColor: '#BFE3CD', fg: colors.success }
      : { backgroundColor: colors.warningSoft, borderColor: '#F3C9A8', fg: colors.warning };
  return (
    <View style={styles.cellWrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Question ${q}: ${a ? describeAnswer(a.chosen) : 'no answer'}${right ? ', right' : a?.key ? `, wrong, the key is ${a.key}` : ''}`}
        style={[
          styles.cell,
          { backgroundColor: tone.backgroundColor, borderColor: tone.borderColor },
          selected && { borderColor: colors.primary, borderWidth: 2 },
        ]}
      >
        <Text style={styles.cellQ}>{q}</Text>
        <Text style={[styles.cellA, { color: tone.fg }]}>{shown}</Text>
        {!right && a?.key ? <Text style={styles.cellKey}>{a.key}</Text> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 32, fontWeight: '800', color: colors.text },
  outOf: { fontSize: 17, fontWeight: '600', color: colors.muted },
  muted: { fontSize: 13, color: colors.muted },
  small: { fontSize: 12, color: colors.muted },
  strong: { fontSize: 15, fontWeight: '700', color: colors.text },
  facts: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderTopColor: '#EEF0F5', paddingTop: space.md },
  factValue: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: space.sm },
  cellWrap: { width: '20%', padding: 3 },
  cell: { height: 42, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  cellQ: { fontSize: 12, color: colors.muted, fontWeight: '500' },
  cellA: { fontSize: 14, fontWeight: '800' },
  cellKey: { fontSize: 11, fontWeight: '700', color: colors.warning },
  answers: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
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
  answerOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  answerText: { fontSize: 15, fontWeight: '700', color: colors.muted },
});
